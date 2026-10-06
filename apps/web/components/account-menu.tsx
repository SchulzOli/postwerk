'use client';

import { useEffect, useRef } from 'react';
import { localeNames } from '@postwerk/core/i18n';
import { logOut } from '@/app/(auth)/actions';
import { setLocaleAction } from '@/app/actions/locale';
import { useLocale, useMessages } from '@/lib/i18n';
import { accountMessages } from '@/messages/account';

interface Props {
  user: { name: string; email: string };
  /** Extra links, e.g. switching between canvas and list view. */
  links?: { href: string; label: string }[];
}

/** The user's initial; opens account settings, extra links, the other language and log out. */
export function AccountMenu({ user, links = [] }: Props) {
  const menu = useRef<HTMLDetailsElement>(null);
  const t = useMessages(accountMessages);
  const other = useLocale() === 'de' ? 'en' : 'de';
  useEffect(() => {
    const close = (event: Event) => {
      if (menu.current?.open && (event instanceof KeyboardEvent ? event.key === 'Escape' : !menu.current.contains(event.target as Node))) menu.current.open = false;
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);
  return (
    <details className="menu account-menu" ref={menu}>
      <summary title={`${user.name} · ${user.email}`} aria-label={t.menu}>
        <span className="avatar-initial">{user.name.slice(0, 1).toUpperCase()}</span>
      </summary>
      <div className="menu-body">
        <div className="stack-sm">
          <strong className="clip">{user.name}</strong>
          <small className="muted clip">{user.email}</small>
        </div>
        <a className="menu-item" href="/account">{t.settings}</a>
        {links.map((link) => (
          <a key={link.href} className="menu-item" href={link.href}>{link.label}</a>
        ))}
        <form action={setLocaleAction.bind(null, other)}>
          <button type="submit" className="menu-item" lang={other}>{localeNames[other]}</button>
        </form>
        <form action={logOut}>
          <button type="submit" className="menu-item">{t.logOut}</button>
        </form>
      </div>
    </details>
  );
}
