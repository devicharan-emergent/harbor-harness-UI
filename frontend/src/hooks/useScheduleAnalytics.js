import { useMemo } from 'react';

/**
 * Extract YYYY-MM-DD suffix from a group_run_id like
 * "<batch_id>-YYYY-MM-DD". Returns null if not parseable.
 */
function extractDate(gid) {
  if (!gid || typeof gid !== 'string') return null;
  const m = gid.match(/(\d{4}-\d{2}-\d{2})$/);
  return m ? m[1] : null;
}

const DONE_STATUSES = new Set(['done', 'completed', 'success', 'succeeded']);

function avg(nums) {
  const valid = nums.filter((n) => typeof n === 'number' && !Number.isNaN(n));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function safeNum(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return null;
  return v;
}

/**
 * useScheduleAnalytics — pure transform of the runs array from
 * listScheduledBatchRuns into shapes consumable by the analytics
 * subsections of ScheduleDetail.
 *
 * The goal of the time-series section is to judge how the agent config
 * chosen for each run performed on every problem over time, so the
 * chart is per-problem (one line per problem) for a single metric at a
 * time. Available metrics are the job-level rewards:
 *   combined_reward, lint_score, browser_reward, lintiq_score
 *
 * Output:
 *   { summary, timeSeries, heatmap }
 */
export default function useScheduleAnalytics(runs) {
  return useMemo(() => {
    const jobs = Array.isArray(runs) ? runs : [];
    const hasData = jobs.length > 0;

    // ── Group jobs by date (from group_run_id) ────────────────────────────
    const byDate = new Map();
    for (const job of jobs) {
      const date = extractDate(job.group_run_id);
      if (!date) continue;
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(job);
    }
    const sortedDates = Array.from(byDate.keys()).sort(); // YYYY-MM-DD sorts lexically

    // ── Unique problems ───────────────────────────────────────────────────
    const problemSet = new Set();
    for (const job of jobs) {
      if (job.problem) problemSet.add(job.problem);
    }
    const problems = Array.from(problemSet).sort();

    // ── SUMMARY ───────────────────────────────────────────────────────────
    const totalJobs = jobs.length;
    const totalRuns = byDate.size;

    const successCount = jobs.filter((j) =>
      DONE_STATUSES.has(String(j.status || '').toLowerCase())
    ).length;
    const successRate =
      totalJobs > 0 ? (successCount / totalJobs) * 100 : null;

    const meanCombined = avg(jobs.map((j) => safeNum(j.combined_reward)));
    const meanLint = avg(jobs.map((j) => safeNum(j.lint_score)));
    const meanBrowser = avg(jobs.map((j) => safeNum(j.browser_reward)));
    const meanLintiq = avg(jobs.map((j) => safeNum(j.lintiq_score)));

    // Duration
    const durations = jobs
      .map((j) => {
        if (!j.created_at || !j.finished_at) return null;
        const s = new Date(j.created_at).getTime();
        const e = new Date(j.finished_at).getTime();
        if (Number.isNaN(s) || Number.isNaN(e) || e < s) return null;
        return e - s;
      })
      .filter((x) => x !== null);
    const avgDurationMs = durations.length > 0 ? avg(durations) : null;

    // Last-run timestamp (most recent created_at across jobs)
    let lastRunAt = null;
    for (const j of jobs) {
      if (!j.created_at) continue;
      if (!lastRunAt || new Date(j.created_at) > new Date(lastRunAt)) {
        lastRunAt = j.created_at;
      }
    }

    // Totals only available if eval_metrics is present (list endpoint doesn't
    // return these; kept so the KPI can gracefully show "—").
    const metricJobs = jobs.filter((j) => j.eval_metrics);
    const totalCostUsd = metricJobs.length
      ? metricJobs.reduce(
          (s, j) => s + (safeNum(j.eval_metrics?.total_cost_usd) || 0),
          0
        )
      : null;

    // Per-date mean combined_reward for trend arrow
    const dateMeans = sortedDates.map((d) => {
      const daily = byDate.get(d);
      return {
        date: d,
        mean: avg(daily.map((j) => safeNum(j.combined_reward))),
      };
    });
    let trendDirection = null;
    let lastRunCombined = null;
    if (dateMeans.length > 0) {
      const latest = dateMeans[dateMeans.length - 1];
      lastRunCombined = latest.mean;
      if (dateMeans.length > 1 && latest.mean !== null) {
        const prev = dateMeans.slice(-8, -1);
        const prevAvg = avg(prev.map((p) => p.mean));
        if (prevAvg !== null) {
          const delta = latest.mean - prevAvg;
          if (Math.abs(delta) < 0.01) trendDirection = 'flat';
          else trendDirection = delta > 0 ? 'up' : 'down';
        }
      }
    }

    // Per-date sparkline series for each top-level metric (used by KPI tiles)
    const combinedSeries = dateMeans.map((d) => d.mean);
    const lintSeries = sortedDates.map((d) =>
      avg(byDate.get(d).map((j) => safeNum(j.lint_score)))
    );
    const browserSeries = sortedDates.map((d) =>
      avg(byDate.get(d).map((j) => safeNum(j.browser_reward)))
    );

    const summary = {
      hasData,
      totalRuns,
      totalJobs,
      successRate,
      successCount,
      meanCombined,
      meanLint,
      meanBrowser,
      meanLintiq,
      avgDurationMs,
      lastRunAt,
      lastRunCombined,
      trendDirection,
      totalCostUsd,
      hasCostData: metricJobs.length > 0,
      combinedSeries,
      lintSeries,
      browserSeries,
    };

    // ── TIME SERIES (per-problem, per-metric) ─────────────────────────────
    // Shape expected by the chart:
    //   rows: [{ date: "2026-02-10", "<problemA>": 0.73, "<problemB>": 0.41 }, ...]
    //   problems: ["<problemA>", "<problemB>", ...]
    //   metrics: ["combined_reward", "lint_score", "browser_reward", "lintiq_score"]
    //   byMetric: { combined_reward: rows, lint_score: rows, ... }
    const METRIC_KEYS = [
      'combined_reward',
      'lint_score',
      'browser_reward',
      'lintiq_score',
    ];

    const byMetric = {};
    for (const metric of METRIC_KEYS) {
      byMetric[metric] = sortedDates.map((date) => {
        const daily = byDate.get(date);
        const row = { date };
        for (const problem of problems) {
          const values = daily
            .filter((j) => j.problem === problem)
            .map((j) => safeNum(j[metric]));
          const m = avg(values);
          row[problem] = m; // null when no sample
        }
        return row;
      });
    }

    const timeSeries = {
      problems,
      metrics: METRIC_KEYS,
      byMetric,
      show: problems.length > 0 && sortedDates.length > 0,
    };

    // ── HEATMAP (per-phase lint scores, per-problem) ──────────────────────
    let maxPhase = -1;
    let anyMultiPhase = false;
    for (const job of jobs) {
      const pr = Array.isArray(job.phase_results) ? job.phase_results : [];
      if (pr.length > 1) anyMultiPhase = true;
      for (const p of pr) {
        if (typeof p.phase_index === 'number' && p.phase_index > maxPhase) {
          maxPhase = p.phase_index;
        }
      }
    }

    const cells = {};
    for (const problem of problems) {
      for (let i = 0; i <= maxPhase; i++) {
        cells[`${problem}::${i}`] = { scores: [] };
      }
    }
    for (const job of jobs) {
      if (!job.problem) continue;
      const pr = Array.isArray(job.phase_results) ? job.phase_results : [];
      for (const p of pr) {
        const key = `${job.problem}::${p.phase_index}`;
        if (!cells[key]) continue;
        const s = safeNum(p.lint_score);
        if (s !== null) cells[key].scores.push(s);
      }
    }
    const heatmapCells = {};
    for (const [key, val] of Object.entries(cells)) {
      heatmapCells[key] = {
        mean: avg(val.scores),
        sample: val.scores.length,
      };
    }

    const heatmap = {
      show: anyMultiPhase && problems.length > 0 && maxPhase >= 0,
      problems,
      maxPhase,
      cells: heatmapCells,
    };

    // ── LEADERBOARD (per-problem ranking) ────────────────────────────────
    // One row per problem with latest, mean, per-metric means, a trend
    // direction derived from first-half vs second-half combined_reward
    // averages, and a combined_reward time series for an inline sparkline.
    const leaderRows = problems.map((problem) => {
      const jobsForProblem = jobs.filter((j) => j.problem === problem);
      // Distinct run dates this problem appeared in
      const runDates = new Set();
      for (const j of jobsForProblem) {
        const d = extractDate(j.group_run_id);
        if (d) runDates.add(d);
      }

      const meanCombinedP = avg(
        jobsForProblem.map((j) => safeNum(j.combined_reward))
      );
      const meanLintP = avg(jobsForProblem.map((j) => safeNum(j.lint_score)));
      const meanBrowserP = avg(
        jobsForProblem.map((j) => safeNum(j.browser_reward))
      );
      const meanLintiqP = avg(
        jobsForProblem.map((j) => safeNum(j.lintiq_score))
      );

      // Combined-reward series ordered by date (for the sparkline)
      const combinedSeriesP = sortedDates.map((date) => {
        const daily = byDate
          .get(date)
          .filter((j) => j.problem === problem);
        return avg(daily.map((j) => safeNum(j.combined_reward)));
      });

      // Latest value = last non-null in combinedSeriesP
      let latestCombined = null;
      let latestDate = null;
      for (let i = combinedSeriesP.length - 1; i >= 0; i--) {
        if (combinedSeriesP[i] !== null) {
          latestCombined = combinedSeriesP[i];
          latestDate = sortedDates[i];
          break;
        }
      }

      // Trend: compare the last point vs the mean of everything before it
      let trend = null;
      const validIdxs = combinedSeriesP
        .map((v, i) => (v !== null ? i : -1))
        .filter((i) => i >= 0);
      if (validIdxs.length >= 2) {
        const lastIdx = validIdxs[validIdxs.length - 1];
        const prior = validIdxs
          .slice(0, -1)
          .map((i) => combinedSeriesP[i]);
        const priorAvg = avg(prior);
        if (priorAvg !== null) {
          const delta = combinedSeriesP[lastIdx] - priorAvg;
          if (Math.abs(delta) < 0.01) trend = 'flat';
          else trend = delta > 0 ? 'up' : 'down';
        }
      }

      return {
        problem,
        runs: runDates.size,
        jobs: jobsForProblem.length,
        latestCombined,
        latestDate,
        meanCombined: meanCombinedP,
        meanLint: meanLintP,
        meanBrowser: meanBrowserP,
        meanLintiq: meanLintiqP,
        combinedSeries: combinedSeriesP,
        trend,
      };
    });

    const leaderboard = {
      show: leaderRows.length > 0,
      rows: leaderRows,
    };

    return { summary, timeSeries, heatmap, leaderboard };
  }, [runs]);
}
