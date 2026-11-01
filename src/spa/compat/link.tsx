import { forwardRef } from "react";
import { Link as RouterLink } from "react-router-dom";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

type RouterLinkProps = ComponentPropsWithoutRef<typeof RouterLink>;

export interface LinkProps
  extends Omit<RouterLinkProps, "to" | "children" | "prefetch"> {
  href: string | { pathname?: string; query?: Record<string, string> };
  children?: ReactNode;
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
  passHref?: boolean;
  legacyBehavior?: boolean;
}

function hrefToString(href: LinkProps["href"]): string {
  if (typeof href === "string") return href;
  const path = href.pathname ?? "/";
  const query = href.query
    ? `?${new URLSearchParams(href.query).toString()}`
    : "";
  return `${path}${query}`;
}

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, prefetch, scroll, passHref, legacyBehavior, ...props },
  ref,
) {
  void prefetch;
  void scroll;
  void passHref;
  void legacyBehavior;
  return <RouterLink ref={ref} to={hrefToString(href)} {...props} />;
});

export default Link;
