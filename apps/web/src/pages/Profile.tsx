import { FormEvent, useState } from 'react';
import { User, Mail, Phone, MapPin, Lock, Camera, CheckCircle2, Loader2, Shield } from 'lucide-react';
import { cn } from '../lib/format';
import { useApp } from '../context/OrderStateContext';
import trustoraLogo from '../assets/trustora-logo.png';

interface UserProfile {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: string;
  bio: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const DEFAULT_PROFILE: UserProfile = {
  firstName: 'Alex',
  lastName: 'Walker',
  email: 'alex.walker@mail.example',
  phone: '+1 (555) 012-3456',
  location: 'San Francisco, CA',
  bio: 'Sample profile text.',
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
  return (
    <div className="relative w-24 h-24 mx-auto">
      <div className="w-24 h-24 rounded-full bg-navy text-white grid place-items-center text-3xl font-bold select-none">
        {initials}
      </div>
      <button
        className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-electric text-white grid place-items-center shadow-l2 hover:opacity-90 transition"
        title="Change photo"
      >
        <Camera size={14} />
      </button>
    </div>
  );
}

export default function Profile() {
  const { toast } = useApp();
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [draft, setDraft] = useState<UserProfile>(DEFAULT_PROFILE);
  const [savingInfo, setSavingInfo] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);
  const [tab, setTab] = useState<'info' | 'security'>('info');

  const set = (k: keyof UserProfile) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));

  const handleSaveInfo = async (e: FormEvent) => {
    e.preventDefault();
    setSavingInfo(true);
    await new Promise((r) => setTimeout(r, 900));
    setProfile(draft);
    toast('Demo only: nothing was saved', 'ok');
    setSavingInfo(false);
  };

  const handleSavePwd = async (e: FormEvent) => {
    e.preventDefault();
    if (draft.newPassword !== draft.confirmPassword) {
      toast('Passwords do not match', 'bad');
      return;
    }
    if (draft.newPassword.length < 8) {
      toast('Password must be at least 8 characters', 'bad');
      return;
    }
    setSavingPwd(true);
    await new Promise((r) => setTimeout(r, 900));
    toast('Demo only: there is no account, so no password was changed', 'ok');
    setDraft((d) => ({ ...d, currentPassword: '', newPassword: '', confirmPassword: '' }));
    setSavingPwd(false);
  };

  const tabCls = (active: boolean) =>
    cn(
      'px-4 py-2 rounded-lg text-sm font-semibold transition',
      active ? 'bg-navy text-white shadow-l1' : 'text-muted hover:text-ink'
    );

  const inputGroup = (
    label: string,
    key: keyof UserProfile,
    type = 'text',
    icon?: React.ReactNode,
    placeholder?: string
  ) => (
    <div key={key}>
      <label htmlFor={key} className="mono-label">
        {label}
      </label>
      <div className="relative mt-1">
        {icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">{icon}</span>
        )}
        <input
          id={key}
          type={type}
          className={cn('input w-full', icon ? 'pl-9' : '')}
          placeholder={placeholder}
          value={draft[key]}
          onChange={set(key)}
        />
      </div>
    </div>
  );

  return (
    <>
      {/* Header */}
      <section>
        <p className="mono-label !text-electric">Account Settings</p>
        <h1 className="text-3xl font-bold mt-1">My Profile</h1>
        <p className="text-muted text-sm mt-1">
          A demo profile. This app has no user accounts, so nothing entered here is saved.
        </p>
      </section>

      {/* Profile card */}
      <section className="card !p-6 flex flex-col sm:flex-row items-center gap-5">
        <Avatar name={`${profile.firstName} ${profile.lastName}`} />
        <div className="text-center sm:text-left">
          <div className="text-xl font-bold">
            {profile.firstName} {profile.lastName}
          </div>
          <div className="text-sm text-muted mt-0.5 font-mono">{profile.email}</div>
          <div className="text-sm text-muted mt-0.5">{profile.location}</div>
          <div className="flex items-center gap-1.5 mt-2 justify-center sm:justify-start">
            <Shield size={13} className="text-electric" />
            <span className="text-xs font-semibold text-electric">Demo profile</span>
          </div>
        </div>
        <div className="sm:ml-auto flex items-center gap-2">
          <img src={trustoraLogo} alt="TrustOra" className="h-10 w-auto object-contain opacity-80" />
        </div>
      </section>

      {/* Tabs */}
      <div className="flex gap-2 bg-canvas rounded-xl p-1 w-fit">
        <button className={tabCls(tab === 'info')} onClick={() => setTab('info')}>
          Personal Info
        </button>
        <button className={tabCls(tab === 'security')} onClick={() => setTab('security')}>
          Security
        </button>
      </div>

      {/* Personal Info Tab */}
      {tab === 'info' && (
        <form onSubmit={handleSaveInfo} className="card space-y-5">
          <h2 className="font-semibold text-base flex items-center gap-2">
            <User size={16} className="text-electric" />
            Personal Information
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {inputGroup('First Name', 'firstName', 'text', undefined, 'First name')}
            {inputGroup('Last Name', 'lastName', 'text', undefined, 'Last name')}
          </div>
          {inputGroup('Email Address', 'email', 'email', <Mail size={15} />, 'you@example.com')}
          {inputGroup('Phone Number', 'phone', 'tel', <Phone size={15} />, '+1 (555) 000-0000')}
          {inputGroup('Location', 'location', 'text', <MapPin size={15} />, 'City, Country')}

          <div>
            <label htmlFor="bio" className="mono-label">
              Bio
            </label>
            <textarea
              id="bio"
              rows={3}
              className="input mt-1 w-full resize-none"
              placeholder="Tell us a little about yourself…"
              value={draft.bio}
              onChange={(e) => setDraft((d) => ({ ...d, bio: e.target.value }))}
            />
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              className="btn-primary flex items-center gap-2"
              disabled={savingInfo}
            >
              {savingInfo ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <CheckCircle2 size={15} />
              )}
              {savingInfo ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      )}

      {/* Security Tab */}
      {tab === 'security' && (
        <form onSubmit={handleSavePwd} className="card space-y-5">
          <h2 className="font-semibold text-base flex items-center gap-2">
            <Lock size={16} className="text-electric" />
            Change Password
          </h2>

          <div>
            <label htmlFor="currentPassword" className="mono-label">
              Current Password
            </label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
                <Lock size={15} />
              </span>
              <input
                id="currentPassword"
                type="password"
                className="input w-full pl-9"
                placeholder="Enter current password"
                value={draft.currentPassword}
                onChange={set('currentPassword')}
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="newPassword" className="mono-label">
              New Password
            </label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
                <Lock size={15} />
              </span>
              <input
                id="newPassword"
                type="password"
                className="input w-full pl-9"
                placeholder="Min. 8 characters"
                value={draft.newPassword}
                onChange={set('newPassword')}
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="confirmPassword" className="mono-label">
              Confirm New Password
            </label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
                <Lock size={15} />
              </span>
              <input
                id="confirmPassword"
                type="password"
                className="input w-full pl-9"
                placeholder="Repeat new password"
                value={draft.confirmPassword}
                onChange={set('confirmPassword')}
                required
              />
            </div>
          </div>

          <div className="rounded-lg bg-tint p-3 text-xs text-muted space-y-1">
            <p className="font-semibold text-ink">Password requirements</p>
            <p>• At least 8 characters long</p>
            <p>• Mix of uppercase, lowercase, numbers recommended</p>
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              className="btn-primary flex items-center gap-2"
              disabled={savingPwd}
            >
              {savingPwd ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Lock size={15} />
              )}
              {savingPwd ? 'Updating…' : 'Update Password'}
            </button>
          </div>
        </form>
      )}
    </>
  );
}

