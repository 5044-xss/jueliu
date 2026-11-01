import { useCallback, useMemo } from "react";
import {
  useLocation,
  useNavigate,
  useParams as useRouterParams,
} from "react-router-dom";

export function usePathname(): string {
  return useLocation().pathname;
}

export function useParams<
  T extends Record<string, string | string[] | undefined> = Record<
    string,
    string | string[] | undefined
  >,
>(): T {
  return useRouterParams() as T;
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams(useLocation().search);
}

export function useRouter() {
  const navigate = useNavigate();
  const push = useCallback(
    (href: string) => {
      navigate(href);
    },
    [navigate],
  );
  const replace = useCallback(
    (href: string) => {
      navigate(href, { replace: true });
    },
    [navigate],
  );
  const back = useCallback(() => {
    navigate(-1);
  }, [navigate]);
  const refresh = useCallback(() => {
    window.location.reload();
  }, []);
  const prefetch = useCallback(() => undefined, []);
  return useMemo(
    () => ({ push, replace, back, refresh, prefetch }),
    [push, replace, back, refresh, prefetch],
  );
}

export function redirect(href: string): never {
  window.location.hash = href.startsWith("/") ? `#${href}` : href;
  throw new Error("redirect");
}

export function notFound(): never {
  throw new Error("notFound");
}
