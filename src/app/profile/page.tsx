"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Calendar,
  Check,
  Loader2,
  Mail,
  Pencil,
  Shield,
  User,
  UserCircle2,
  X,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import { fetchProfileRequest, resendVerificationRequest, updateProfileRequest } from "@/lib/auth/api";
import type { AuthUser } from "@/lib/auth/types";
import { formatDateOfBirthForDisplay } from "@/lib/auth/profile-validation";
import { buildProfileUpdate } from "@/lib/auth/profile-update";
import { DeleteAccountSection } from "@/components/profile/DeleteAccountSection";
import { ExportDataSection } from "@/components/profile/ExportDataSection";
import { safeNavigate } from "@/lib/navigation/safe-navigate";
import { isCheckoutReturnPending } from "@/lib/billing/pre-checkout-view";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const inputFocus =
  "focus:outline-none focus:ring-2 focus:ring-teal-500/35 focus:border-teal-400/55";

function formatMemberSince(iso: string): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function ProfilePage() {
  const router = useRouter();
  const { isAuthenticated, isHydrated, patchUser } = useAuth();
  const { ui, isWhiteLab } = useTheme();
  const { t } = useLanguage();

  const [profile, setProfile] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");

  const inputClass = cn(
    "w-full rounded-xl border py-2.5 px-3 text-sm transition-colors",
    inputFocus,
    "disabled:opacity-60",
    isWhiteLab
      ? "border-slate-300 bg-white text-neutral-900 placeholder:text-neutral-400"
      : "border-white/10 bg-black/30 text-white placeholder:text-gray-600 [color-scheme:dark]",
  );

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProfileRequest();
      setProfile(data);
      setFirstName(data.firstName);
      setLastName(data.lastName);
      setDateOfBirth(data.dateOfBirth);
      patchUser(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : (t.profile_load_failed ?? "Profile could not be loaded."),
      );
    } finally {
      setLoading(false);
    }
  }, [patchUser, t.profile_load_failed]);

  useEffect(() => {
    if (!isHydrated) return;
    if (!isAuthenticated) {
      if (isCheckoutReturnPending()) return;
      safeNavigate(router, "/login", "replace");
      return;
    }
    void loadProfile();
  }, [isHydrated, isAuthenticated, router, loadProfile]);

  const cancelEdit = useCallback(() => {
    if (profile) {
      setFirstName(profile.firstName);
      setLastName(profile.lastName);
      setDateOfBirth(profile.dateOfBirth);
    }
    setFormError(null);
    setEditMode(false);
  }, [profile]);

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!profile) return;
      // Only what changed is sent; a field the user emptied is sent as null (cleared), a field that was and is empty is not sent.
      const result = buildProfileUpdate(
        { firstName: profile.firstName, lastName: profile.lastName, dateOfBirth: profile.dateOfBirth },
        { firstName, lastName, dateOfBirth },
      );
      if (result.error !== null) {
        setFormError(result.error);
        return;
      }
      const updates = result.updates;
      if (Object.keys(updates).length === 0) {
        setFormError(null);
        setEditMode(false);
        return;
      }

      setFormError(null);
      setSaving(true);
      try {
        const updated = await updateProfileRequest(updates);
        setProfile(updated);
        patchUser(updated);
        setEditMode(false);
        toast.success(t.profile_save_success ?? "Profile updated successfully.");
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : (t.profile_save_failed ?? "Profile could not be updated.");
        setFormError(message);
        toast.error(message);
      } finally {
        setSaving(false);
      }
    },
    [profile, firstName, lastName, dateOfBirth, patchUser, t.profile_save_failed, t.profile_save_success],
  );

  const onResendVerification = useCallback(async () => {
    if (!profile?.email) return;
    setResending(true);
    try {
      const result = await resendVerificationRequest(profile.email);
      toast.success(result.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to resend verification email.");
    } finally {
      setResending(false);
    }
  }, [profile?.email]);

  if (!isHydrated || !isAuthenticated) {
    return (
      <main className="min-h-screen flex items-center justify-center pt-24">
        <Loader2 className="h-8 w-8 animate-spin text-teal-400" />
      </main>
    );
  }

  return (
    <main className="min-h-screen pt-24 pb-16 px-4 sm:px-6">
      <div className="mx-auto max-w-2xl space-y-8">
        <motion.header
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-2 text-center sm:text-left"
        >
          <div
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs",
              isWhiteLab
                ? "border-teal-200 bg-teal-50 text-teal-900"
                : "border-teal-400/30 bg-teal-500/10 text-teal-200",
            )}
          >
            <UserCircle2 className="h-3.5 w-3.5" />
            {t.profile_badge ?? "User Profile"}
          </div>
          <h1 className={cn("text-3xl font-bold sm:text-4xl", ui.typography.title)}>
            {t.profile_title ?? "Your Profile"}
          </h1>
          <p className={cn("text-sm sm:text-base max-w-xl", ui.typography.subtitle)}>
            {t.profile_subtitle ??
              "Manage your personal details and keep your MoleculeStudio identity up to date."}
          </p>
        </motion.header>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06 }}
          className={cn(
            "relative overflow-hidden rounded-3xl border p-6 sm:p-8 backdrop-blur-md",
            isWhiteLab
              ? "border-slate-200 bg-white/80 shadow-lg shadow-slate-200/40"
              : "border-white/10 bg-white/5 shadow-2xl shadow-black/30",
          )}
        >
          {!isWhiteLab && (
            <>
              <div
                className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-teal-400/10 blur-3xl"
                aria-hidden
              />
              <div
                className="pointer-events-none absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-cyan-400/10 blur-3xl"
                aria-hidden
              />
            </>
          )}

          <div className="relative space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <div
                  className={cn(
                    "flex h-14 w-14 items-center justify-center rounded-2xl border",
                    isWhiteLab
                      ? "border-teal-200 bg-teal-50"
                      : "border-teal-400/35 bg-teal-500/15 shadow-[0_0_24px_rgba(45,212,191,0.2)]",
                  )}
                >
                  <User className={cn("h-7 w-7", isWhiteLab ? "text-teal-700" : "text-teal-300")} />
                </div>
                <div>
                  <p className={cn("text-lg font-semibold", ui.typography.title)}>
                    {profile ? `${profile.firstName} ${profile.lastName}`.trim() || profile.email : "—"}
                  </p>
                  <p className={cn("text-sm", ui.typography.muted)}>{profile?.email ?? "—"}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {profile && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                      profile.isVerified
                        ? isWhiteLab
                          ? "border-teal-300/80 bg-teal-50 text-teal-900"
                          : "border-teal-400/40 bg-teal-500/15 text-teal-200"
                        : isWhiteLab
                          ? "border-amber-300/80 bg-amber-50 text-amber-900"
                          : "border-amber-400/40 bg-amber-500/15 text-amber-200",
                    )}
                  >
                    {profile.isVerified
                      ? (t.profile_verified_badge ?? "Verified")
                      : (t.profile_unverified_badge ?? "Unverified")}
                  </span>
                )}
                {profile?.isAdmin && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                      isWhiteLab
                        ? "border-amber-300/80 bg-amber-50 text-amber-900"
                        : "border-amber-400/40 bg-amber-500/15 text-amber-200 shadow-[0_0_16px_rgba(251,191,36,0.15)]",
                    )}
                  >
                    <Shield className="h-3.5 w-3.5" />
                    {t.profile_admin_badge ?? "Admin"}
                  </span>
                )}
                {!editMode && !loading && profile && (
                  <button
                    type="button"
                    onClick={() => setEditMode(true)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
                      isWhiteLab
                        ? "border-slate-300 bg-white text-neutral-800 hover:bg-slate-50"
                        : "border-white/15 bg-white/5 text-gray-200 hover:border-teal-400/40 hover:bg-teal-500/10",
                    )}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    {t.profile_edit_button ?? "Edit Profile"}
                  </button>
                )}
              </div>
            </div>

            {loading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-7 w-7 animate-spin text-teal-400" />
              </div>
            )}

            {error && !loading && (
              <div className="space-y-4 text-center py-6">
                <p className="text-sm text-red-400">{error}</p>
                <button
                  type="button"
                  onClick={() => void loadProfile()}
                  className={cn(
                    "rounded-xl border px-4 py-2 text-sm font-medium",
                    isWhiteLab
                      ? "border-slate-300 bg-white"
                      : "border-white/15 bg-white/5 hover:bg-white/10",
                  )}
                >
                  {t.profile_retry ?? "Try again"}
                </button>
              </div>
            )}

            {!loading && !error && profile && !profile.isVerified && (
              <div
                className={cn(
                  "rounded-2xl border px-4 py-3 text-sm flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
                  isWhiteLab
                    ? "border-amber-300 bg-amber-50 text-amber-950"
                    : "border-amber-400/30 bg-amber-500/10 text-amber-100",
                )}
              >
                <p>
                  {t.profile_verify_prompt ??
                    "Verify your email to unlock AI Lab features and your 10 starter credits."}
                </p>
                <button
                  type="button"
                  disabled={resending}
                  onClick={() => void onResendVerification()}
                  className={cn(
                    "inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-50",
                    isWhiteLab
                      ? "border-amber-400 bg-white text-amber-950"
                      : "border-amber-400/40 bg-amber-500/20 text-amber-50",
                  )}
                >
                  {resending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                  {t.profile_resend_verification ?? "Resend link"}
                </button>
              </div>
            )}

            {!loading && !error && profile && (
              <>
                {!editMode ? (
                  <dl className="grid gap-4 sm:grid-cols-2">
                    <div
                      className={cn(
                        "rounded-2xl border p-4",
                        isWhiteLab ? "border-slate-200 bg-slate-50/80" : "border-white/10 bg-black/20",
                      )}
                    >
                      <dt className={cn("text-[11px] uppercase tracking-wider", ui.typography.muted)}>
                        {t.profile_first_name ?? "First Name"}
                      </dt>
                      <dd className={cn("mt-1 text-sm font-medium", ui.typography.title)}>
                        {profile.firstName || "—"}
                      </dd>
                    </div>
                    <div
                      className={cn(
                        "rounded-2xl border p-4",
                        isWhiteLab ? "border-slate-200 bg-slate-50/80" : "border-white/10 bg-black/20",
                      )}
                    >
                      <dt className={cn("text-[11px] uppercase tracking-wider", ui.typography.muted)}>
                        {t.profile_last_name ?? "Last Name"}
                      </dt>
                      <dd className={cn("mt-1 text-sm font-medium", ui.typography.title)}>
                        {profile.lastName || "—"}
                      </dd>
                    </div>
                    <div
                      className={cn(
                        "rounded-2xl border p-4",
                        isWhiteLab ? "border-slate-200 bg-slate-50/80" : "border-white/10 bg-black/20",
                      )}
                    >
                      <dt className={cn("text-[11px] uppercase tracking-wider", ui.typography.muted)}>
                        {t.profile_dob ?? "Date of Birth"}
                      </dt>
                      <dd className={cn("mt-1 text-sm font-medium", ui.typography.title)}>
                        {formatDateOfBirthForDisplay(profile.dateOfBirth)}
                      </dd>
                    </div>
                    <div
                      className={cn(
                        "rounded-2xl border p-4",
                        isWhiteLab ? "border-slate-200 bg-slate-50/80" : "border-white/10 bg-black/20",
                      )}
                    >
                      <dt className={cn("text-[11px] uppercase tracking-wider", ui.typography.muted)}>
                        {t.profile_member_since ?? "Member Since"}
                      </dt>
                      <dd className={cn("mt-1 text-sm font-medium", ui.typography.title)}>
                        {formatMemberSince(profile.createdAt)}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
                    <label className="block space-y-1.5">
                      <span className={cn("text-xs font-medium", ui.typography.label)}>
                        {t.profile_first_name ?? "First Name"}
                      </span>
                      <input
                        type="text"
                        autoComplete="given-name"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        disabled={saving}
                        className={inputClass}
                      />
                    </label>

                    <label className="block space-y-1.5">
                      <span className={cn("text-xs font-medium", ui.typography.label)}>
                        {t.profile_last_name ?? "Last Name"}
                      </span>
                      <input
                        type="text"
                        autoComplete="family-name"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        disabled={saving}
                        className={inputClass}
                      />
                    </label>

                    <label className="block space-y-1.5">
                      <span className={cn("text-xs font-medium", ui.typography.label)}>
                        {t.profile_dob ?? "Date of Birth"}
                      </span>
                      <div className="relative">
                        <Calendar
                          className={cn(
                            "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2",
                            ui.typography.iconMuted,
                          )}
                        />
                        <input
                          type="date"
                          value={dateOfBirth}
                          onChange={(e) => setDateOfBirth(e.target.value)}
                          disabled={saving}
                          className={cn(inputClass, "pl-10")}
                        />
                      </div>
                    </label>

                    <label className="block space-y-1.5">
                      <span className={cn("text-xs font-medium", ui.typography.label)}>
                        {t.auth_email_label ?? "Email"}
                      </span>
                      <div className="relative">
                        <Mail
                          className={cn(
                            "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2",
                            ui.typography.iconMuted,
                          )}
                        />
                        <input
                          type="email"
                          value={profile.email}
                          readOnly
                          disabled
                          className={cn(inputClass, "pl-10 cursor-not-allowed opacity-70")}
                        />
                      </div>
                      <p className={cn("text-[11px]", ui.typography.muted)}>
                        {t.profile_email_readonly ?? "Email cannot be changed here."}
                      </p>
                    </label>

                    {formError && (
                      <p
                        className="text-xs text-red-400 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2"
                        role="alert"
                      >
                        {formError}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-3 pt-2">
                      <button
                        type="submit"
                        disabled={saving}
                        className={cn(
                          "inline-flex flex-1 min-w-[10rem] items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold border transition-all",
                          ui.nav.cta,
                          "disabled:opacity-50 disabled:cursor-not-allowed",
                        )}
                      >
                        {saving ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {t.profile_saving ?? "Saving…"}
                          </>
                        ) : (
                          <>
                            <Check className="h-4 w-4" />
                            {t.profile_save_button ?? "Save Changes"}
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        disabled={saving}
                        className={cn(
                          "inline-flex items-center justify-center gap-2 rounded-xl border px-5 py-3 text-sm font-medium transition-all",
                          isWhiteLab
                            ? "border-slate-300 bg-white text-neutral-800 hover:bg-slate-50"
                            : "border-white/15 bg-white/5 text-gray-200 hover:bg-white/10",
                          "disabled:opacity-50",
                        )}
                      >
                        <X className="h-4 w-4" />
                        {t.profile_cancel ?? "Cancel"}
                      </button>
                    </div>
                  </form>
                )}

                <div
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-3 border-t pt-5",
                    isWhiteLab ? "border-slate-200" : "border-white/10",
                  )}
                >
                  <p className={cn("text-xs", ui.typography.muted)}>
                    {t.profile_dashboard_hint ?? "View credits and billing history on your dashboard."}
                  </p>
                  <Link
                    href="/dashboard"
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-semibold transition-all",
                      isWhiteLab
                        ? "border-teal-300/80 bg-teal-50 text-teal-800 shadow-sm hover:bg-teal-100 hover:text-teal-950"
                        : "border-teal-400/45 bg-teal-500/15 text-teal-200 shadow-[0_0_18px_rgba(45,212,191,0.25)] hover:border-teal-300/70 hover:bg-teal-500/25 hover:text-teal-50",
                    )}
                  >
                    {t.nav_dashboard ?? "Dashboard"} →
                  </Link>
                </div>
              </>
            )}
          </div>
        </motion.section>

        {!loading && !error && profile && <ExportDataSection />}
        {!loading && !error && profile && (
          <DeleteAccountSection
            scheduledFor={profile.deletionScheduledFor}
            onCancelled={() => setProfile((p) => (p ? { ...p, deletionScheduledFor: null } : p))}
          />
        )}
      </div>
    </main>
  );
}
