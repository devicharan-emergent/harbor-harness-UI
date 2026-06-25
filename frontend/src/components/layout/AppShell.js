import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Menu, Cpu, Home, GitCompare, MessageSquare, ActivitySquare, Database, CalendarClock, Boxes, Scale, FileCode2, BookMarked } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { EnvSwitcher } from './EnvSwitcher';
import { ApiHealthIndicator } from '@/components/evals/ApiHealthIndicator';
import { DataSourceIndicator } from './DataSourceIndicator';
import { UserMenu } from './UserMenu';

const navItems = [
  { label: 'Agents', href: '/', icon: Home },
  { label: 'Wizard', href: '/wizard', icon: MessageSquare },
  { label: 'Evals', href: '/evals', icon: ActivitySquare },
  { label: 'Schedules', href: '/schedules', icon: CalendarClock },
  { label: 'Cortex Agents', href: '/cortex/agents', icon: Boxes },
  { label: 'Datasets', href: '/datasets', icon: Database },
  { label: 'Dataset Views', href: '/dataset-views', icon: BookMarked },
  { label: 'Verifier Config', href: '/judge-config', icon: Scale },
  { label: 'Agent & Prompt Management', href: '/agent-prompt-management', icon: FileCode2 },
  { label: 'Compare', href: '/compare', icon: GitCompare },
];

export default function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  const NavContent = () => (
    <div className="flex flex-col h-full p-3 overflow-y-auto">
      {/* Logo header */}
      <div className="px-2.5 py-3 mb-2 flex-shrink-0">
        <Link to="/" className="flex items-center gap-2 no-underline group">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(var(--primary)/0.7)] flex items-center justify-center shadow-sm">
            <Cpu className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-foreground leading-none">ACM</h1>
            <p className="text-[10px] text-muted-foreground leading-none mt-1">Agent Config Manager</p>
          </div>
        </Link>
      </div>
      
      {/* Hairline separator */}
      <div className="hairline-separator h-px mx-2 mb-3 flex-shrink-0" />
      
      {/* Navigation */}
      <nav className="flex-1 space-y-1 min-h-0">
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = location.pathname === item.href;
          return (
            <Link key={item.href} to={item.href} onClick={() => setMobileOpen(false)}>
              <button
                className={`
                  w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium
                  transition-all duration-150
                  ${
                    isActive
                      ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)]'
                      : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent)/0.5)] hover:text-foreground'
                  }
                `}
                data-testid={`nav-${item.label.toLowerCase()}`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </button>
            </Link>
          );
        })}
      </nav>
      
      {/* Footer with data source, health indicator, theme toggle, and version */}
      <div className="pt-3 mt-3 border-t border-[hsl(var(--border)/0.5)] space-y-2 flex-shrink-0">
        <DataSourceIndicator />
        {/*
         * The harness-eval health chip is irrelevant on the Cortex Agents
         * page — that page reads cortex_<eph> directly, not the eval API.
         * A red "degraded" chip would make the page look broken when it's
         * fine. Hide on /cortex/* to avoid that confusion.
         */}
        {!location.pathname.startsWith('/cortex/') && <ApiHealthIndicator />}
        <EnvSwitcher />
        <UserMenu />
        <div className="flex items-center justify-between px-2.5">
          <span className="text-xs text-muted-foreground">v1.0.0</span>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );

  return (
    <div className="relative min-h-screen">
      {/* Background with subtle pattern */}
      <div className="fixed inset-0 bg-background -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,hsl(var(--accent)/0.15),transparent_50%)]" />
        <div className="noise absolute inset-0" />
      </div>

      {/* Desktop Sidebar - Fixed position, full viewport height with proper containment */}
      <aside 
        className="hidden md:block fixed top-0 left-0 w-[220px] h-screen bg-card border-r border-border z-40" 
        data-testid="app-sidebar"
      >
        <NavContent />
      </aside>

      {/* Mobile menu trigger - floating button */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild className="md:hidden fixed top-4 left-4 z-50">
          <Button variant="default" size="icon" className="h-10 w-10 rounded-full shadow-lg">
            <Menu className="w-5 h-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0 glass-surface-strong border-r border-[hsl(var(--border)/0.3)]">
          <NavContent />
        </SheetContent>
      </Sheet>

      {/* Main Content - Offset by sidebar width on desktop */}
      <main 
        className="min-h-screen md:ml-[220px] px-3 sm:px-4 lg:px-6 py-4 md:py-6" 
        data-testid="app-content"
      >
        <div className="max-w-[1400px] mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
