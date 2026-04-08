import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { RotateCcw } from 'lucide-react';

export function SliderWithNumber({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  defaultValue,
  description,
  testId,
}) {
  const handleSlider = (vals) => {
    onChange(vals[0]);
  };

  const handleInput = (e) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val)) {
      onChange(Math.min(max, Math.max(min, val)));
    }
  };

  return (
    <div className="space-y-2">
      {label && (
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
          {defaultValue !== undefined && value !== defaultValue && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-xs text-muted-foreground"
              onClick={() => onChange(defaultValue)}
            >
              <RotateCcw className="w-3 h-3 mr-1" />
              Reset
            </Button>
          )}
        </div>
      )}
      <div className="grid grid-cols-[1fr_96px] items-center gap-3" data-testid={testId}>
        <Slider
          value={[value]}
          onValueChange={handleSlider}
          min={min}
          max={max}
          step={step}
          className="flex-1"
        />
        <Input
          type="number"
          value={value}
          onChange={handleInput}
          min={min}
          max={max}
          step={step}
          className="font-mono tabular-nums text-sm h-8"
        />
      </div>
      {description && (
        <p className="text-xs text-muted-foreground">
          {description} (min: {min}, max: {max})
        </p>
      )}
    </div>
  );
}
