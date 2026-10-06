import { ForgotPasswordForm } from '@/components/password-forms';
import { getMessages } from '@/lib/i18n-server';
import { authMessages } from '@/messages/auth';
import { commonMessages } from '@/messages/common';

export async function generateMetadata() {
  const [t, common] = await Promise.all([getMessages(authMessages), getMessages(commonMessages)]);
  return { title: common.title(t.titles.forgotPassword) };
}

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
