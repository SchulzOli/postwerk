import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth-form';
import { getSession } from '@/lib/session';
import { signUp } from '../actions';

export const metadata = { title: 'Sign up · Postwerk' };

export default async function SignupPage() {
  if (await getSession()) redirect('/canvas');
  return <AuthForm mode="signup" action={signUp} />;
}
