import { FormEvent, useState } from 'react';
import { usePageTitle } from '../hooks/usePageTitle';
import { cn } from '../lib/format';
import { useApp } from '../context/OrderStateContext';

interface UserProfile { firstName: string; lastName: string; email: string; phone: string; location: string; currentPassword: string; newPassword: string; confirmPassword: string }

const DEFAULT_PROFILE: UserProfile = {
  firstName: 'Alex', lastName: 'Walker', email: 'alex.walker@mail.example', phone: '+1 (555) 012-3456', location: 'San Francisco, CA',
  currentPassword: '', newPassword: '', confirmPassword: '',
};

/** A sample profile. There are no accounts, so nothing here is saved. */
export default function Profile() {
  usePageTitle('Sample profile');
  const { toast } = useApp();
  const [draft, setDraft] = useState<UserProfile>(DEFAULT_PROFILE);
  const [tab, setTab] = useState<'info' | 'security'>('info');
  const set = (k: keyof UserProfile) => (e: { target: { value: string } }) => setDraft(d => ({ ...d, [k]: e.target.value }));

  const saveInfo = (e: FormEvent) => { e.preventDefault(); toast('Demo only: nothing was saved', 'ok'); };
  const savePwd = (e: FormEvent) => {
    e.preventDefault();
    if (draft.newPassword !== draft.confirmPassword) { toast('Passwords do not match', 'bad'); return; }
    if (draft.newPassword.length < 8) { toast('Password must be at least 8 characters', 'bad'); return; }
    toast('Demo only: there is no account, so no password was changed', 'ok');
    setDraft(d => ({ ...d, currentPassword: '', newPassword: '', confirmPassword: '' }));
  };
  const field = (label: string, key: keyof UserProfile, type = 'text') => <div key={key}>
    <label htmlFor={key} className="label block mb-1">{label}</label>
    <input id={key} type={type} className="input" value={draft[key]} onChange={set(key)} required={type === 'password'} /></div>;
  const tabCls = (active: boolean) => cn('h-10 px-1 mr-6 text-sm font-medium border-b-2', active ? 'border-action text-content' : 'border-transparent text-muted hover:text-content');

  return <div className="max-w-xl space-y-6">
    <section><h1>Sample profile</h1>
      <p className="text-muted mt-1">This app has no user accounts, so nothing entered here is saved.</p></section>
    <div role="tablist" aria-label="Profile sections" className="border-b border-line">
      <button role="tab" aria-selected={tab === 'info'} className={tabCls(tab === 'info')} onClick={() => setTab('info')}>Details</button>
      <button role="tab" aria-selected={tab === 'security'} className={tabCls(tab === 'security')} onClick={() => setTab('security')}>Security</button>
    </div>
    {tab === 'info' && <form onSubmit={saveInfo} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">{field('First name', 'firstName')}{field('Last name', 'lastName')}</div>
      {field('Email address', 'email', 'email')}{field('Phone number', 'phone', 'tel')}{field('Location', 'location')}
      <button type="submit" className="btn-primary">Save changes</button>
    </form>}
    {tab === 'security' && <form onSubmit={savePwd} className="space-y-4">
      {field('Current password', 'currentPassword', 'password')}{field('New password', 'newPassword', 'password')}{field('Confirm new password', 'confirmPassword', 'password')}
      <p className="text-sm text-muted">At least 8 characters. Nothing is sent anywhere.</p>
      <button type="submit" className="btn-primary">Update password</button>
    </form>}
  </div>;
}
