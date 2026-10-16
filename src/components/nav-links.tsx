"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, Home, Library, Settings } from "lucide-react";
import { cn } from "@core/client/utils";

const ITEMS = [
  { href: "/", label: "首页", icon: Home, match: (p: string) => p === "/" },
  {
    href: "/projects",
    label: "项目",
    icon: Clapperboard,
    match: (p: string) => p.startsWith("/projects"),
  },
  {
    href: "/library/styles",
    label: "资源库",
    icon: Library,
    match: (p: string) => p.startsWith("/library"),
  },
  {
    href: "/settings",
    label: "设置",
    icon: Settings,
    match: (p: string) => p.startsWith("/settings"),
  },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1 text-sm">
      {ITEMS.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <item.icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
