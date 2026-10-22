import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { hrefFor, navigate, type Route } from '../route.ts';

export function Link({ to, ...rest }: { to: Route } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick'>) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={hrefFor(to)} onClick={onClick} {...rest} />;
}
