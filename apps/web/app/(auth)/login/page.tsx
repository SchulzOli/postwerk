import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth-form';
import { getSession } from '@/lib/session';
import { logIn } from '../actions';

export const metadata = { title: 'Log in · Postwerk' };

export default async function LoginPage() {
  if (await getSession()) redirect('/canvas');
  return <AuthForm mode="login" action={logIn} />;
}
