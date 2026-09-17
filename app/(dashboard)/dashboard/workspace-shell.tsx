'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  Clapperboard,
  ClipboardCheck,
  FileCheck2,
  Film,
  LayoutDashboard,
  Layers3,
  LibraryBig,
  ListVideo,
  Menu,
  Package,
  Palette,
  Settings,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const navigationItems = [
  {
    href: '/dashboard',
    icon: LayoutDashboard,
    label: 'Workspace',
  },
  {
    href: '/dashboard/brand-kits',
    icon: Palette,
    label: 'Brand kits',
  },
  {
    href: '/dashboard/catalog',
    icon: Package,
    label: 'SKU Catalog',
  },
  {
    href: '/dashboard/references',
    icon: Film,
    label: 'Reference videos',
  },
  {
    href: '/dashboard/specs',
    icon: FileCheck2,
    label: 'Creative Specs',
  },
  {
    href: '/dashboard/skills',
    icon: LibraryBig,
    label: 'Shot Skills',
  },
  {
    href: '/dashboard/batches',
    icon: Layers3,
    label: 'Production Batches',
  },
  {
    href: '/dashboard/campaigns',
    icon: Clapperboard,
    label: 'Campaigns',
  },
  {
    href: '/dashboard/jobs',
    icon: ListVideo,
    label: 'Video jobs',
  },
  {
    href: '/dashboard/reviews',
    icon: ClipboardCheck,
    label: 'Reviews',
  },
  {
    href: '/dashboard/settings/team',
    icon: Settings,
    label: 'Workspace settings',
  },
];

export function WorkspaceShell({
  children,
  workspaceName,
}: {
  children: React.ReactNode;
  workspaceName: string;
}) {
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-68px)] w-full max-w-7xl flex-col">
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 lg:hidden">
        <div>
          <p className="text-sm font-medium text-gray-900">{workspaceName}</p>
          <p className="text-xs text-muted-foreground">Workspace</p>
        </div>
        <Button
          aria-expanded={isSidebarOpen}
          className="-mr-2"
          onClick={() => setIsSidebarOpen((open) => !open)}
          size="icon"
          variant="ghost"
        >
          {isSidebarOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          <span className="sr-only">Toggle workspace navigation</span>
        </Button>
      </div>

      <div className="flex flex-1">
        <aside
          className={`w-64 shrink-0 border-r border-gray-200 bg-gray-50 lg:relative lg:block ${
            isSidebarOpen ? 'block' : 'hidden'
          } absolute inset-x-0 top-[68px] z-40 min-h-[calc(100dvh-68px)] lg:inset-auto lg:min-h-0`}
        >
          <div className="border-b border-gray-200 px-5 py-5">
            <p className="truncate font-semibold text-gray-950">{workspaceName}</p>
            <p className="mt-1 text-xs text-muted-foreground">AI video workspace</p>
          </div>
          <nav aria-label="Workspace navigation" className="p-3">
            {navigationItems.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(`${item.href}/`);

              return (
                <Button
                  asChild
                  className="mb-1 w-full justify-start shadow-none"
                  key={item.href}
                  variant={isActive ? 'secondary' : 'ghost'}
                >
                  <Link
                    aria-current={isActive ? 'page' : undefined}
                    href={item.href}
                    onClick={() => setIsSidebarOpen(false)}
                  >
                    <item.icon className="size-4" />
                    {item.label}
                  </Link>
                </Button>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
