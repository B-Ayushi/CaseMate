import type { ComponentType, SVGProps } from 'react';
import { ClientsIcon } from './icons';

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

// Only sections that are built appear here.
export const navItems: NavItem[] = [{ to: '/clients', label: 'Clients', icon: ClientsIcon }];
