import type { ComponentType, SVGProps } from 'react';
import {
  BillingIcon,
  CalendarIcon,
  CasesIcon,
  ClientsIcon,
  DashboardIcon,
  SettingsIcon,
} from './icons';

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

// Only sections that are built appear here.
export const navItems: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: DashboardIcon },
  { to: '/cases', label: 'Cases', icon: CasesIcon },
  { to: '/calendar', label: 'Calendar', icon: CalendarIcon },
  { to: '/clients', label: 'Clients', icon: ClientsIcon },
  { to: '/billing', label: 'Billing', icon: BillingIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];
