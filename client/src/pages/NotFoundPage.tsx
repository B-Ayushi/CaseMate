import { EmptyState, ButtonLink } from '../components/ui';

export function NotFoundPage() {
  return (
    <EmptyState title="Page not found" action={<ButtonLink to="/">Go to CaseMate</ButtonLink>}>
      The page you are looking for does not exist.
    </EmptyState>
  );
}
