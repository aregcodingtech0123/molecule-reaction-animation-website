# I18N review — account UI strings (FINDING-27)

> **Machine-translated.** Every string below was added in Phase 1.5 and has **not** been reviewed by
> a native speaker. Please check meaning, tone and length (buttons and table headers must stay short).
> Brand and product names are intentionally untranslated: MoleculeStudio, AI Lab, Lemon Squeezy, MoR
> (merchant of record), USD, Google.

Source of truth: `src/lib/i18n/content/account-ui.json` (English: `src/lib/i18n/ui-extensions.ts`).
This file is generated and checked by `tests/unit/i18n/account-ui.test.ts`; after editing a translation run
`I18N_REVIEW_UPDATE=1 npx vitest run tests/unit/i18n/account-ui.test.ts`.

84 keys × 11 locales = 924 strings (the 83 keys of FINDING-27 plus `dashboard_load_more`, added with the dashboard pagination of FINDING-17).

Kept identical to English after review: de: `auth_credits_label`; fr: `dashboard_col_date`, `dashboard_col_description`, `dashboard_col_type`; it: `auth_email_label`, `auth_password_label`.

To correct a string, edit `account-ui.json` and regenerate this file; record the reviewer per locale in the PR.

## Review first — legal, pricing and billing wording

These 22 keys (marked ⚑ in every locale table) carry legal, pricing or billing meaning.
Review them first in each locale. **Refund wording:** none of the added strings mentions refunds; the ledger type
labels shown on the dashboard ("Auto Refund", "Refund", …, `src/lib/billing/history.ts`) are not localised at all
and stay English in every locale — translating them is a separate item.

| Key | Area | English | Why it matters |
| --- | --- | --- | --- |
| `billing_feature_never_expire` | legal | Credits never expire | a promise to the buyer (credits never expire); must not over- or under-state it |
| `billing_secure_note` | legal | Lemon Squeezy MoR (USD) · Credits applied after verified webhook | names the merchant of record and when credits are granted |
| `billing_via_lemon` | legal | Paid via Lemon Squeezy (MoR) | states who the seller / merchant of record is |
| `billing_buy_now` | legal | Buy Now | purchase button; some jurisdictions (e.g. DE "zahlungspflichtig bestellen") regulate order-button wording — the binding order happens on Lemon Squeezy's page |
| `auth_signup_bonus` | legal | New accounts receive 10 starter AI credits. | promise of free credits (number and condition) |
| `billing_best_value` | pricing | Best Value | comparative price claim |
| `billing_title` | pricing | Purchase AI Credits | purchase page heading |
| `billing_subtitle` | pricing | Buy AI credits securely with Lemon Squeezy. | purchase description and payment provider |
| `billing_get_started` | pricing | Get Started | purchase call-to-action |
| `billing_feature_3d` | pricing | 3D molecule generation | what a paid pack includes |
| `billing_credits_unit` | pricing | credits | unit shown next to every price / pack size |
| `pricing_page_title` | pricing | Pricing | pricing page heading |
| `pricing_page_subtitle` | pricing | Browse credit packs freely. Guests can explore all plans — sign in only when you are ready to purchase. | states when sign-in / purchase is required |
| `billing_current_balance` | billing | Current balance | account balance label |
| `billing_redirecting` | billing | Redirecting… | shown while sending the buyer to the payment page |
| `dashboard_balance_label` | billing | AI Credits | account balance label |
| `dashboard_buy_credits` | billing | Purchase more credits | purchase entry point |
| `dashboard_history_title` | billing | Credit & Usage History | heading of the transaction record |
| `dashboard_col_amount` | billing | Amount | amount column of the transaction record |
| `dashboard_subtitle` | billing | Manage your AI credits and review your full transaction ledger. | describes the transaction ledger |
| `profile_dashboard_hint` | billing | View credits and billing history on your dashboard. | points to the billing history |
| `auth_credits_label` | billing | Credits | balance label in the account menu |

Out of scope (open, not part of FINDING-27): other UI groups (AI Lab, toasts, measurement and atom-focus
labels, studio CTA cards) exist in every locale but still show the English text in most of them.

## tr — Türkçe

| Priority | Key | English | Translation |
| --- | --- | --- | --- |
| ⚑ billing | `auth_credits_label` | Credits | Kredi |
|  | `auth_dob_label` | Date of Birth | Doğum Tarihi |
|  | `auth_email_label` | Email | E-posta |
|  | `auth_error_generic` | Request could not be completed. | İstek tamamlanamadı. |
|  | `auth_error_invalid` | Invalid credentials. | Geçersiz kimlik bilgileri. |
|  | `auth_first_name_label` | First Name | Ad |
|  | `auth_google_button` | Sign in with Google | Google ile giriş yap |
|  | `auth_google_divider` | or continue with email | veya e-posta ile devam edin |
|  | `auth_google_unavailable` | Google sign-in is not configured for this environment. | Google ile giriş bu ortamda yapılandırılmamış. |
|  | `auth_last_name_label` | Last Name | Soyad |
|  | `auth_loading` | Please wait… | Lütfen bekleyin… |
|  | `auth_login_button` | Log In | Giriş Yap |
|  | `auth_login_title` | Sign in to your lab | Laboratuvarınıza giriş yapın |
|  | `auth_logout` | Logout | Çıkış Yap |
|  | `auth_modal_subtitle` | Access AI structure generation and credit balance | Yapay zekâ ile yapı üretimine ve kredi bakiyenize erişin |
|  | `auth_password_label` | Password | Şifre |
|  | `auth_register_button` | Sign Up | Kayıt Ol |
|  | `auth_register_title` | Create your account | Hesabınızı oluşturun |
| ⚑ legal | `auth_signup_bonus` | New accounts receive 10 starter AI credits. | Yeni hesaplara 10 başlangıç yapay zekâ kredisi verilir. |
|  | `auth_submit_login` | Log In | Giriş Yap |
|  | `auth_submit_register` | Create Account | Hesap Oluştur |
|  | `auth_tab_login` | Log In | Giriş Yap |
|  | `auth_tab_register` | Sign Up | Kayıt Ol |
|  | `auth_val_dob` | Enter a valid date of birth. | Geçerli bir doğum tarihi girin. |
|  | `auth_val_email_invalid` | Enter a valid email address. | Geçerli bir e-posta adresi girin. |
|  | `auth_val_email_required` | Email is required. | E-posta gereklidir. |
|  | `auth_val_first_name` | First name is required. | Ad gereklidir. |
|  | `auth_val_last_name` | Last name is required. | Soyad gereklidir. |
|  | `auth_val_password_length` | Password must be at least 8 characters. | Şifre en az 8 karakter olmalıdır. |
|  | `auth_val_password_letter` | Password must include a letter. | Şifre en az bir harf içermelidir. |
|  | `auth_val_password_number` | Password must include a number. | Şifre en az bir rakam içermelidir. |
|  | `auth_val_password_required` | Password is required. | Şifre gereklidir. |
| ⚑ pricing | `billing_best_value` | Best Value | En Avantajlı |
| ⚑ legal | `billing_buy_now` | Buy Now | Hemen Satın Al |
| ⚑ pricing | `billing_credits_unit` | credits | kredi |
| ⚑ billing | `billing_current_balance` | Current balance | Mevcut bakiye |
| ⚑ pricing | `billing_feature_3d` | 3D molecule generation | 3B molekül üretimi |
| ⚑ legal | `billing_feature_never_expire` | Credits never expire | Kredilerin süresi dolmaz |
| ⚑ pricing | `billing_get_started` | Get Started | Başlayın |
| ⚑ billing | `billing_redirecting` | Redirecting… | Yönlendiriliyor… |
| ⚑ legal | `billing_secure_note` | Lemon Squeezy MoR (USD) · Credits applied after verified webhook | Lemon Squeezy MoR (USD) · Krediler doğrulanmış webhook sonrasında yüklenir |
| ⚑ pricing | `billing_subtitle` | Buy AI credits securely with Lemon Squeezy. | Yapay zekâ kredilerini Lemon Squeezy ile güvenle satın alın. |
| ⚑ pricing | `billing_title` | Purchase AI Credits | Yapay Zekâ Kredisi Satın Alın |
| ⚑ legal | `billing_via_lemon` | Paid via Lemon Squeezy (MoR) | Ödeme Lemon Squeezy (MoR) üzerinden |
|  | `dashboard_badge` | Account Dashboard | Hesap Paneli |
| ⚑ billing | `dashboard_balance_label` | AI Credits | Yapay Zekâ Kredisi |
| ⚑ billing | `dashboard_buy_credits` | Purchase more credits | Daha fazla kredi satın alın |
| ⚑ billing | `dashboard_col_amount` | Amount | Miktar |
|  | `dashboard_col_date` | Date | Tarih |
|  | `dashboard_col_description` | Description | Açıklama |
|  | `dashboard_col_reference` | Reference | Referans |
|  | `dashboard_col_type` | Type | Tür |
|  | `dashboard_email_label` | Signed in as | Giriş yapılan hesap |
|  | `dashboard_empty_body` | Run your first AI structure generation to begin your ledger. | İşlem geçmişinizi başlatmak için ilk yapay zekâ yapı üretiminizi çalıştırın. |
|  | `dashboard_empty_cta` | Open AI Lab | AI Lab'ı Aç |
|  | `dashboard_empty_title` | No transactions yet | Henüz işlem yok |
| ⚑ billing | `dashboard_history_title` | Credit & Usage History | Kredi ve Kullanım Geçmişi |
|  | `dashboard_load_more` | Load more | Daha fazla yükle |
|  | `dashboard_quick_links` | Quick links | Hızlı bağlantılar |
| ⚑ billing | `dashboard_subtitle` | Manage your AI credits and review your full transaction ledger. | Yapay zekâ kredilerinizi yönetin ve tüm işlem kayıtlarınızı inceleyin. |
|  | `dashboard_title` | Your MoleculeStudio Account | MoleculeStudio Hesabınız |
|  | `nav_dashboard` | Dashboard | Panel |
|  | `nav_pricing` | Pricing | Fiyatlandırma |
|  | `nav_profile` | Profile | Profil |
| ⚑ pricing | `pricing_page_subtitle` | Browse credit packs freely. Guests can explore all plans — sign in only when you are ready to purchase. | Kredi paketlerine serbestçe göz atın. Misafirler tüm planları inceleyebilir — yalnızca satın almaya hazır olduğunuzda giriş yapın. |
| ⚑ pricing | `pricing_page_title` | Pricing | Fiyatlandırma |
|  | `profile_admin_badge` | Admin | Yönetici |
|  | `profile_badge` | User Profile | Kullanıcı Profili |
|  | `profile_cancel` | Cancel | İptal |
| ⚑ billing | `profile_dashboard_hint` | View credits and billing history on your dashboard. | Kredilerinizi ve ödeme geçmişinizi panelinizde görüntüleyin. |
|  | `profile_dob` | Date of Birth | Doğum Tarihi |
|  | `profile_edit_button` | Edit Profile | Profili Düzenle |
|  | `profile_email_readonly` | Email cannot be changed here. | E-posta burada değiştirilemez. |
|  | `profile_first_name` | First Name | Ad |
|  | `profile_last_name` | Last Name | Soyad |
|  | `profile_load_failed` | Profile could not be loaded. | Profil yüklenemedi. |
|  | `profile_member_since` | Member Since | Üyelik Tarihi |
|  | `profile_retry` | Try again | Tekrar dene |
|  | `profile_save_button` | Save Changes | Değişiklikleri Kaydet |
|  | `profile_save_failed` | Profile could not be updated. | Profil güncellenemedi. |
|  | `profile_save_success` | Profile updated successfully. | Profil başarıyla güncellendi. |
|  | `profile_saving` | Saving… | Kaydediliyor… |
|  | `profile_subtitle` | Manage your personal details and keep your MoleculeStudio identity up to date. | Kişisel bilgilerinizi yönetin ve MoleculeStudio kimliğinizi güncel tutun. |
|  | `profile_title` | Your Profile | Profiliniz |

## de — Deutsch

| Priority | Key | English | Translation |
| --- | --- | --- | --- |
| ⚑ billing | `auth_credits_label` | Credits | Credits |
|  | `auth_dob_label` | Date of Birth | Geburtsdatum |
|  | `auth_email_label` | Email | E-Mail |
|  | `auth_error_generic` | Request could not be completed. | Die Anfrage konnte nicht abgeschlossen werden. |
|  | `auth_error_invalid` | Invalid credentials. | Ungültige Anmeldedaten. |
|  | `auth_first_name_label` | First Name | Vorname |
|  | `auth_google_button` | Sign in with Google | Mit Google anmelden |
|  | `auth_google_divider` | or continue with email | oder mit E-Mail fortfahren |
|  | `auth_google_unavailable` | Google sign-in is not configured for this environment. | Die Google-Anmeldung ist in dieser Umgebung nicht eingerichtet. |
|  | `auth_last_name_label` | Last Name | Nachname |
|  | `auth_loading` | Please wait… | Bitte warten… |
|  | `auth_login_button` | Log In | Anmelden |
|  | `auth_login_title` | Sign in to your lab | Im Labor anmelden |
|  | `auth_logout` | Logout | Abmelden |
|  | `auth_modal_subtitle` | Access AI structure generation and credit balance | Zugriff auf KI-Strukturerzeugung und Credit-Guthaben |
|  | `auth_password_label` | Password | Passwort |
|  | `auth_register_button` | Sign Up | Registrieren |
|  | `auth_register_title` | Create your account | Konto erstellen |
| ⚑ legal | `auth_signup_bonus` | New accounts receive 10 starter AI credits. | Neue Konten erhalten 10 KI-Start-Credits. |
|  | `auth_submit_login` | Log In | Anmelden |
|  | `auth_submit_register` | Create Account | Konto erstellen |
|  | `auth_tab_login` | Log In | Anmelden |
|  | `auth_tab_register` | Sign Up | Registrieren |
|  | `auth_val_dob` | Enter a valid date of birth. | Gültiges Geburtsdatum eingeben. |
|  | `auth_val_email_invalid` | Enter a valid email address. | Gültige E-Mail-Adresse eingeben. |
|  | `auth_val_email_required` | Email is required. | E-Mail ist erforderlich. |
|  | `auth_val_first_name` | First name is required. | Vorname ist erforderlich. |
|  | `auth_val_last_name` | Last name is required. | Nachname ist erforderlich. |
|  | `auth_val_password_length` | Password must be at least 8 characters. | Das Passwort muss mindestens 8 Zeichen lang sein. |
|  | `auth_val_password_letter` | Password must include a letter. | Das Passwort muss einen Buchstaben enthalten. |
|  | `auth_val_password_number` | Password must include a number. | Das Passwort muss eine Ziffer enthalten. |
|  | `auth_val_password_required` | Password is required. | Passwort ist erforderlich. |
| ⚑ pricing | `billing_best_value` | Best Value | Bestes Angebot |
| ⚑ legal | `billing_buy_now` | Buy Now | Jetzt kaufen |
| ⚑ pricing | `billing_credits_unit` | credits | Credits |
| ⚑ billing | `billing_current_balance` | Current balance | Aktuelles Guthaben |
| ⚑ pricing | `billing_feature_3d` | 3D molecule generation | 3D-Molekülerzeugung |
| ⚑ legal | `billing_feature_never_expire` | Credits never expire | Credits verfallen nie |
| ⚑ pricing | `billing_get_started` | Get Started | Loslegen |
| ⚑ billing | `billing_redirecting` | Redirecting… | Weiterleitung… |
| ⚑ legal | `billing_secure_note` | Lemon Squeezy MoR (USD) · Credits applied after verified webhook | Lemon Squeezy MoR (USD) · Credits werden nach verifiziertem Webhook gutgeschrieben |
| ⚑ pricing | `billing_subtitle` | Buy AI credits securely with Lemon Squeezy. | KI-Credits sicher über Lemon Squeezy kaufen. |
| ⚑ pricing | `billing_title` | Purchase AI Credits | KI-Credits kaufen |
| ⚑ legal | `billing_via_lemon` | Paid via Lemon Squeezy (MoR) | Bezahlt über Lemon Squeezy (MoR) |
|  | `dashboard_badge` | Account Dashboard | Konto-Übersicht |
| ⚑ billing | `dashboard_balance_label` | AI Credits | KI-Credits |
| ⚑ billing | `dashboard_buy_credits` | Purchase more credits | Weitere Credits kaufen |
| ⚑ billing | `dashboard_col_amount` | Amount | Betrag |
|  | `dashboard_col_date` | Date | Datum |
|  | `dashboard_col_description` | Description | Beschreibung |
|  | `dashboard_col_reference` | Reference | Referenz |
|  | `dashboard_col_type` | Type | Typ |
|  | `dashboard_email_label` | Signed in as | Angemeldet als |
|  | `dashboard_empty_body` | Run your first AI structure generation to begin your ledger. | Starte deine erste KI-Strukturerzeugung, um dein Transaktionsbuch zu beginnen. |
|  | `dashboard_empty_cta` | Open AI Lab | AI Lab öffnen |
|  | `dashboard_empty_title` | No transactions yet | Noch keine Transaktionen |
| ⚑ billing | `dashboard_history_title` | Credit & Usage History | Credit- und Nutzungsverlauf |
|  | `dashboard_load_more` | Load more | Mehr laden |
|  | `dashboard_quick_links` | Quick links | Schnellzugriff |
| ⚑ billing | `dashboard_subtitle` | Manage your AI credits and review your full transaction ledger. | KI-Credits verwalten und das vollständige Transaktionsbuch einsehen. |
|  | `dashboard_title` | Your MoleculeStudio Account | Dein MoleculeStudio-Konto |
|  | `nav_dashboard` | Dashboard | Übersicht |
|  | `nav_pricing` | Pricing | Preise |
|  | `nav_profile` | Profile | Profil |
| ⚑ pricing | `pricing_page_subtitle` | Browse credit packs freely. Guests can explore all plans — sign in only when you are ready to purchase. | Credit-Pakete frei durchstöbern. Gäste können alle Pakete ansehen — anmelden erst, wenn du kaufen möchtest. |
| ⚑ pricing | `pricing_page_title` | Pricing | Preise |
|  | `profile_admin_badge` | Admin | Administrator |
|  | `profile_badge` | User Profile | Benutzerprofil |
|  | `profile_cancel` | Cancel | Abbrechen |
| ⚑ billing | `profile_dashboard_hint` | View credits and billing history on your dashboard. | Credits und Zahlungsverlauf findest du in deiner Übersicht. |
|  | `profile_dob` | Date of Birth | Geburtsdatum |
|  | `profile_edit_button` | Edit Profile | Profil bearbeiten |
|  | `profile_email_readonly` | Email cannot be changed here. | Die E-Mail-Adresse kann hier nicht geändert werden. |
|  | `profile_first_name` | First Name | Vorname |
|  | `profile_last_name` | Last Name | Nachname |
|  | `profile_load_failed` | Profile could not be loaded. | Profil konnte nicht geladen werden. |
|  | `profile_member_since` | Member Since | Mitglied seit |
|  | `profile_retry` | Try again | Erneut versuchen |
|  | `profile_save_button` | Save Changes | Änderungen speichern |
|  | `profile_save_failed` | Profile could not be updated. | Profil konnte nicht aktualisiert werden. |
|  | `profile_save_success` | Profile updated successfully. | Profil erfolgreich aktualisiert. |
|  | `profile_saving` | Saving… | Wird gespeichert… |
|  | `profile_subtitle` | Manage your personal details and keep your MoleculeStudio identity up to date. | Persönliche Angaben verwalten und die MoleculeStudio-Identität aktuell halten. |
|  | `profile_title` | Your Profile | Dein Profil |

## es — Español

| Priority | Key | English | Translation |
| --- | --- | --- | --- |
| ⚑ billing | `auth_credits_label` | Credits | Créditos |
|  | `auth_dob_label` | Date of Birth | Fecha de nacimiento |
|  | `auth_email_label` | Email | Correo electrónico |
|  | `auth_error_generic` | Request could not be completed. | No se pudo completar la solicitud. |
|  | `auth_error_invalid` | Invalid credentials. | Credenciales no válidas. |
|  | `auth_first_name_label` | First Name | Nombre |
|  | `auth_google_button` | Sign in with Google | Iniciar sesión con Google |
|  | `auth_google_divider` | or continue with email | o continúa con tu correo |
|  | `auth_google_unavailable` | Google sign-in is not configured for this environment. | El inicio de sesión con Google no está configurado en este entorno. |
|  | `auth_last_name_label` | Last Name | Apellido |
|  | `auth_loading` | Please wait… | Espera un momento… |
|  | `auth_login_button` | Log In | Iniciar sesión |
|  | `auth_login_title` | Sign in to your lab | Inicia sesión en tu laboratorio |
|  | `auth_logout` | Logout | Cerrar sesión |
|  | `auth_modal_subtitle` | Access AI structure generation and credit balance | Accede a la generación de estructuras con IA y a tu saldo de créditos |
|  | `auth_password_label` | Password | Contraseña |
|  | `auth_register_button` | Sign Up | Registrarse |
|  | `auth_register_title` | Create your account | Crea tu cuenta |
| ⚑ legal | `auth_signup_bonus` | New accounts receive 10 starter AI credits. | Las cuentas nuevas reciben 10 créditos de IA de bienvenida. |
|  | `auth_submit_login` | Log In | Iniciar sesión |
|  | `auth_submit_register` | Create Account | Crear cuenta |
|  | `auth_tab_login` | Log In | Iniciar sesión |
|  | `auth_tab_register` | Sign Up | Registrarse |
|  | `auth_val_dob` | Enter a valid date of birth. | Introduce una fecha de nacimiento válida. |
|  | `auth_val_email_invalid` | Enter a valid email address. | Introduce un correo electrónico válido. |
|  | `auth_val_email_required` | Email is required. | El correo electrónico es obligatorio. |
|  | `auth_val_first_name` | First name is required. | El nombre es obligatorio. |
|  | `auth_val_last_name` | Last name is required. | El apellido es obligatorio. |
|  | `auth_val_password_length` | Password must be at least 8 characters. | La contraseña debe tener al menos 8 caracteres. |
|  | `auth_val_password_letter` | Password must include a letter. | La contraseña debe incluir una letra. |
|  | `auth_val_password_number` | Password must include a number. | La contraseña debe incluir un número. |
|  | `auth_val_password_required` | Password is required. | La contraseña es obligatoria. |
| ⚑ pricing | `billing_best_value` | Best Value | Mejor relación calidad-precio |
| ⚑ legal | `billing_buy_now` | Buy Now | Comprar ahora |
| ⚑ pricing | `billing_credits_unit` | credits | créditos |
| ⚑ billing | `billing_current_balance` | Current balance | Saldo actual |
| ⚑ pricing | `billing_feature_3d` | 3D molecule generation | Generación de moléculas en 3D |
| ⚑ legal | `billing_feature_never_expire` | Credits never expire | Los créditos no caducan |
| ⚑ pricing | `billing_get_started` | Get Started | Empezar |
| ⚑ billing | `billing_redirecting` | Redirecting… | Redirigiendo… |
| ⚑ legal | `billing_secure_note` | Lemon Squeezy MoR (USD) · Credits applied after verified webhook | Lemon Squeezy MoR (USD) · Los créditos se aplican tras un webhook verificado |
| ⚑ pricing | `billing_subtitle` | Buy AI credits securely with Lemon Squeezy. | Compra créditos de IA de forma segura con Lemon Squeezy. |
| ⚑ pricing | `billing_title` | Purchase AI Credits | Comprar créditos de IA |
| ⚑ legal | `billing_via_lemon` | Paid via Lemon Squeezy (MoR) | Pago a través de Lemon Squeezy (MoR) |
|  | `dashboard_badge` | Account Dashboard | Panel de la cuenta |
| ⚑ billing | `dashboard_balance_label` | AI Credits | Créditos de IA |
| ⚑ billing | `dashboard_buy_credits` | Purchase more credits | Comprar más créditos |
| ⚑ billing | `dashboard_col_amount` | Amount | Importe |
|  | `dashboard_col_date` | Date | Fecha |
|  | `dashboard_col_description` | Description | Descripción |
|  | `dashboard_col_reference` | Reference | Referencia |
|  | `dashboard_col_type` | Type | Tipo |
|  | `dashboard_email_label` | Signed in as | Sesión iniciada como |
|  | `dashboard_empty_body` | Run your first AI structure generation to begin your ledger. | Ejecuta tu primera generación de estructuras con IA para empezar tu historial. |
|  | `dashboard_empty_cta` | Open AI Lab | Abrir AI Lab |
|  | `dashboard_empty_title` | No transactions yet | Aún no hay transacciones |
| ⚑ billing | `dashboard_history_title` | Credit & Usage History | Historial de créditos y uso |
|  | `dashboard_load_more` | Load more | Cargar más |
|  | `dashboard_quick_links` | Quick links | Accesos rápidos |
| ⚑ billing | `dashboard_subtitle` | Manage your AI credits and review your full transaction ledger. | Gestiona tus créditos de IA y revisa el historial completo de transacciones. |
|  | `dashboard_title` | Your MoleculeStudio Account | Tu cuenta de MoleculeStudio |
|  | `nav_dashboard` | Dashboard | Panel |
|  | `nav_pricing` | Pricing | Precios |
|  | `nav_profile` | Profile | Perfil |
| ⚑ pricing | `pricing_page_subtitle` | Browse credit packs freely. Guests can explore all plans — sign in only when you are ready to purchase. | Explora los paquetes de créditos libremente. Los invitados pueden ver todos los planes; inicia sesión solo cuando quieras comprar. |
| ⚑ pricing | `pricing_page_title` | Pricing | Precios |
|  | `profile_admin_badge` | Admin | Administrador |
|  | `profile_badge` | User Profile | Perfil de usuario |
|  | `profile_cancel` | Cancel | Cancelar |
| ⚑ billing | `profile_dashboard_hint` | View credits and billing history on your dashboard. | Consulta tus créditos y tu historial de pagos en el panel. |
|  | `profile_dob` | Date of Birth | Fecha de nacimiento |
|  | `profile_edit_button` | Edit Profile | Editar perfil |
|  | `profile_email_readonly` | Email cannot be changed here. | El correo electrónico no se puede cambiar aquí. |
|  | `profile_first_name` | First Name | Nombre |
|  | `profile_last_name` | Last Name | Apellido |
|  | `profile_load_failed` | Profile could not be loaded. | No se pudo cargar el perfil. |
|  | `profile_member_since` | Member Since | Miembro desde |
|  | `profile_retry` | Try again | Reintentar |
|  | `profile_save_button` | Save Changes | Guardar cambios |
|  | `profile_save_failed` | Profile could not be updated. | No se pudo actualizar el perfil. |
|  | `profile_save_success` | Profile updated successfully. | Perfil actualizado correctamente. |
|  | `profile_saving` | Saving… | Guardando… |
|  | `profile_subtitle` | Manage your personal details and keep your MoleculeStudio identity up to date. | Gestiona tus datos personales y mantén al día tu identidad en MoleculeStudio. |
|  | `profile_title` | Your Profile | Tu perfil |

## pt — Português

| Priority | Key | English | Translation |
| --- | --- | --- | --- |
| ⚑ billing | `auth_credits_label` | Credits | Créditos |
|  | `auth_dob_label` | Date of Birth | Data de nascimento |
|  | `auth_email_label` | Email | E-mail |
|  | `auth_error_generic` | Request could not be completed. | Não foi possível concluir o pedido. |
|  | `auth_error_invalid` | Invalid credentials. | Credenciais inválidas. |
|  | `auth_first_name_label` | First Name | Nome próprio |
|  | `auth_google_button` | Sign in with Google | Iniciar sessão com o Google |
|  | `auth_google_divider` | or continue with email | ou continue com e-mail |
|  | `auth_google_unavailable` | Google sign-in is not configured for this environment. | O início de sessão com o Google não está configurado neste ambiente. |
|  | `auth_last_name_label` | Last Name | Apelido |
|  | `auth_loading` | Please wait… | Aguarde… |
|  | `auth_login_button` | Log In | Iniciar sessão |
|  | `auth_login_title` | Sign in to your lab | Inicie sessão no seu laboratório |
|  | `auth_logout` | Logout | Terminar sessão |
|  | `auth_modal_subtitle` | Access AI structure generation and credit balance | Aceda à geração de estruturas com IA e ao seu saldo de créditos |
|  | `auth_password_label` | Password | Palavra-passe |
|  | `auth_register_button` | Sign Up | Registar |
|  | `auth_register_title` | Create your account | Crie a sua conta |
| ⚑ legal | `auth_signup_bonus` | New accounts receive 10 starter AI credits. | As contas novas recebem 10 créditos de IA iniciais. |
|  | `auth_submit_login` | Log In | Iniciar sessão |
|  | `auth_submit_register` | Create Account | Criar conta |
|  | `auth_tab_login` | Log In | Iniciar sessão |
|  | `auth_tab_register` | Sign Up | Registar |
|  | `auth_val_dob` | Enter a valid date of birth. | Introduza uma data de nascimento válida. |
|  | `auth_val_email_invalid` | Enter a valid email address. | Introduza um endereço de e-mail válido. |
|  | `auth_val_email_required` | Email is required. | O e-mail é obrigatório. |
|  | `auth_val_first_name` | First name is required. | O nome próprio é obrigatório. |
|  | `auth_val_last_name` | Last name is required. | O apelido é obrigatório. |
|  | `auth_val_password_length` | Password must be at least 8 characters. | A palavra-passe deve ter pelo menos 8 caracteres. |
|  | `auth_val_password_letter` | Password must include a letter. | A palavra-passe deve incluir uma letra. |
|  | `auth_val_password_number` | Password must include a number. | A palavra-passe deve incluir um número. |
|  | `auth_val_password_required` | Password is required. | A palavra-passe é obrigatória. |
| ⚑ pricing | `billing_best_value` | Best Value | Melhor valor |
| ⚑ legal | `billing_buy_now` | Buy Now | Comprar agora |
| ⚑ pricing | `billing_credits_unit` | credits | créditos |
| ⚑ billing | `billing_current_balance` | Current balance | Saldo atual |
| ⚑ pricing | `billing_feature_3d` | 3D molecule generation | Geração de moléculas em 3D |
| ⚑ legal | `billing_feature_never_expire` | Credits never expire | Os créditos nunca expiram |
| ⚑ pricing | `billing_get_started` | Get Started | Começar |
| ⚑ billing | `billing_redirecting` | Redirecting… | A redirecionar… |
| ⚑ legal | `billing_secure_note` | Lemon Squeezy MoR (USD) · Credits applied after verified webhook | Lemon Squeezy MoR (USD) · Créditos aplicados após webhook verificado |
| ⚑ pricing | `billing_subtitle` | Buy AI credits securely with Lemon Squeezy. | Compre créditos de IA em segurança com o Lemon Squeezy. |
| ⚑ pricing | `billing_title` | Purchase AI Credits | Comprar créditos de IA |
| ⚑ legal | `billing_via_lemon` | Paid via Lemon Squeezy (MoR) | Pago através do Lemon Squeezy (MoR) |
|  | `dashboard_badge` | Account Dashboard | Painel da conta |
| ⚑ billing | `dashboard_balance_label` | AI Credits | Créditos de IA |
| ⚑ billing | `dashboard_buy_credits` | Purchase more credits | Comprar mais créditos |
| ⚑ billing | `dashboard_col_amount` | Amount | Montante |
|  | `dashboard_col_date` | Date | Data |
|  | `dashboard_col_description` | Description | Descrição |
|  | `dashboard_col_reference` | Reference | Referência |
|  | `dashboard_col_type` | Type | Tipo |
|  | `dashboard_email_label` | Signed in as | Sessão iniciada como |
|  | `dashboard_empty_body` | Run your first AI structure generation to begin your ledger. | Execute a sua primeira geração de estruturas com IA para iniciar o seu histórico. |
|  | `dashboard_empty_cta` | Open AI Lab | Abrir o AI Lab |
|  | `dashboard_empty_title` | No transactions yet | Ainda não há transações |
| ⚑ billing | `dashboard_history_title` | Credit & Usage History | Histórico de créditos e utilização |
|  | `dashboard_load_more` | Load more | Carregar mais |
|  | `dashboard_quick_links` | Quick links | Ligações rápidas |
| ⚑ billing | `dashboard_subtitle` | Manage your AI credits and review your full transaction ledger. | Gira os seus créditos de IA e consulte o histórico completo de transações. |
|  | `dashboard_title` | Your MoleculeStudio Account | A sua conta MoleculeStudio |
|  | `nav_dashboard` | Dashboard | Painel |
|  | `nav_pricing` | Pricing | Preços |
|  | `nav_profile` | Profile | Perfil |
| ⚑ pricing | `pricing_page_subtitle` | Browse credit packs freely. Guests can explore all plans — sign in only when you are ready to purchase. | Explore os pacotes de créditos à vontade. Os visitantes podem ver todos os planos — inicie sessão apenas quando estiver pronto para comprar. |
| ⚑ pricing | `pricing_page_title` | Pricing | Preços |
|  | `profile_admin_badge` | Admin | Administrador |
|  | `profile_badge` | User Profile | Perfil do utilizador |
|  | `profile_cancel` | Cancel | Cancelar |
| ⚑ billing | `profile_dashboard_hint` | View credits and billing history on your dashboard. | Consulte os créditos e o histórico de pagamentos no seu painel. |
|  | `profile_dob` | Date of Birth | Data de nascimento |
|  | `profile_edit_button` | Edit Profile | Editar perfil |
|  | `profile_email_readonly` | Email cannot be changed here. | O e-mail não pode ser alterado aqui. |
|  | `profile_first_name` | First Name | Nome próprio |
|  | `profile_last_name` | Last Name | Apelido |
|  | `profile_load_failed` | Profile could not be loaded. | Não foi possível carregar o perfil. |
|  | `profile_member_since` | Member Since | Membro desde |
|  | `profile_retry` | Try again | Tentar novamente |
|  | `profile_save_button` | Save Changes | Guardar alterações |
|  | `profile_save_failed` | Profile could not be updated. | Não foi possível atualizar o perfil. |
|  | `profile_save_success` | Profile updated successfully. | Perfil atualizado com sucesso. |
|  | `profile_saving` | Saving… | A guardar… |
|  | `profile_subtitle` | Manage your personal details and keep your MoleculeStudio identity up to date. | Gira os seus dados pessoais e mantenha a sua identidade MoleculeStudio atualizada. |
|  | `profile_title` | Your Profile | O seu perfil |

## ko — 한국어

| Priority | Key | English | Translation |
| --- | --- | --- | --- |
| ⚑ billing | `auth_credits_label` | Credits | 크레딧 |
|  | `auth_dob_label` | Date of Birth | 생년월일 |
|  | `auth_email_label` | Email | 이메일 |
|  | `auth_error_generic` | Request could not be completed. | 요청을 완료할 수 없습니다. |
|  | `auth_error_invalid` | Invalid credentials. | 로그인 정보가 올바르지 않습니다. |
|  | `auth_first_name_label` | First Name | 이름 |
|  | `auth_google_button` | Sign in with Google | Google로 로그인 |
|  | `auth_google_divider` | or continue with email | 또는 이메일로 계속하기 |
|  | `auth_google_unavailable` | Google sign-in is not configured for this environment. | 이 환경에서는 Google 로그인이 설정되어 있지 않습니다. |
|  | `auth_last_name_label` | Last Name | 성 |
|  | `auth_loading` | Please wait… | 잠시 기다려 주세요… |
|  | `auth_login_button` | Log In | 로그인 |
|  | `auth_login_title` | Sign in to your lab | 내 실험실에 로그인 |
|  | `auth_logout` | Logout | 로그아웃 |
|  | `auth_modal_subtitle` | Access AI structure generation and credit balance | AI 구조 생성과 크레딧 잔액을 이용하세요 |
|  | `auth_password_label` | Password | 비밀번호 |
|  | `auth_register_button` | Sign Up | 회원가입 |
|  | `auth_register_title` | Create your account | 계정 만들기 |
| ⚑ legal | `auth_signup_bonus` | New accounts receive 10 starter AI credits. | 신규 계정에는 AI 시작 크레딧 10개가 지급됩니다. |
|  | `auth_submit_login` | Log In | 로그인 |
|  | `auth_submit_register` | Create Account | 계정 만들기 |
|  | `auth_tab_login` | Log In | 로그인 |
|  | `auth_tab_register` | Sign Up | 회원가입 |
|  | `auth_val_dob` | Enter a valid date of birth. | 올바른 생년월일을 입력하세요. |
|  | `auth_val_email_invalid` | Enter a valid email address. | 올바른 이메일 주소를 입력하세요. |
|  | `auth_val_email_required` | Email is required. | 이메일을 입력해야 합니다. |
|  | `auth_val_first_name` | First name is required. | 이름을 입력해야 합니다. |
|  | `auth_val_last_name` | Last name is required. | 성을 입력해야 합니다. |
|  | `auth_val_password_length` | Password must be at least 8 characters. | 비밀번호는 8자 이상이어야 합니다. |
|  | `auth_val_password_letter` | Password must include a letter. | 비밀번호에 문자가 하나 이상 포함되어야 합니다. |
|  | `auth_val_password_number` | Password must include a number. | 비밀번호에 숫자가 하나 이상 포함되어야 합니다. |
|  | `auth_val_password_required` | Password is required. | 비밀번호를 입력해야 합니다. |
| ⚑ pricing | `billing_best_value` | Best Value | 최고 가성비 |
| ⚑ legal | `billing_buy_now` | Buy Now | 지금 구매 |
| ⚑ pricing | `billing_credits_unit` | credits | 크레딧 |
| ⚑ billing | `billing_current_balance` | Current balance | 현재 잔액 |
| ⚑ pricing | `billing_feature_3d` | 3D molecule generation | 3D 분자 생성 |
| ⚑ legal | `billing_feature_never_expire` | Credits never expire | 크레딧은 만료되지 않습니다 |
| ⚑ pricing | `billing_get_started` | Get Started | 시작하기 |
| ⚑ billing | `billing_redirecting` | Redirecting… | 이동 중… |
| ⚑ legal | `billing_secure_note` | Lemon Squeezy MoR (USD) · Credits applied after verified webhook | Lemon Squeezy MoR (USD) · 웹훅 검증 후 크레딧이 지급됩니다 |
| ⚑ pricing | `billing_subtitle` | Buy AI credits securely with Lemon Squeezy. | Lemon Squeezy로 AI 크레딧을 안전하게 구매하세요. |
| ⚑ pricing | `billing_title` | Purchase AI Credits | AI 크레딧 구매 |
| ⚑ legal | `billing_via_lemon` | Paid via Lemon Squeezy (MoR) | Lemon Squeezy(MoR)로 결제 |
|  | `dashboard_badge` | Account Dashboard | 계정 대시보드 |
| ⚑ billing | `dashboard_balance_label` | AI Credits | AI 크레딧 |
| ⚑ billing | `dashboard_buy_credits` | Purchase more credits | 크레딧 추가 구매 |
| ⚑ billing | `dashboard_col_amount` | Amount | 수량 |
|  | `dashboard_col_date` | Date | 날짜 |
|  | `dashboard_col_description` | Description | 설명 |
|  | `dashboard_col_reference` | Reference | 참조 |
|  | `dashboard_col_type` | Type | 유형 |
|  | `dashboard_email_label` | Signed in as | 로그인 계정 |
|  | `dashboard_empty_body` | Run your first AI structure generation to begin your ledger. | 첫 AI 구조 생성을 실행하면 거래 내역이 시작됩니다. |
|  | `dashboard_empty_cta` | Open AI Lab | AI Lab 열기 |
|  | `dashboard_empty_title` | No transactions yet | 아직 거래가 없습니다 |
| ⚑ billing | `dashboard_history_title` | Credit & Usage History | 크레딧 및 사용 내역 |
|  | `dashboard_load_more` | Load more | 더 보기 |
|  | `dashboard_quick_links` | Quick links | 바로가기 |
| ⚑ billing | `dashboard_subtitle` | Manage your AI credits and review your full transaction ledger. | AI 크레딧을 관리하고 전체 거래 내역을 확인하세요. |
|  | `dashboard_title` | Your MoleculeStudio Account | 내 MoleculeStudio 계정 |
|  | `nav_dashboard` | Dashboard | 대시보드 |
|  | `nav_pricing` | Pricing | 요금제 |
|  | `nav_profile` | Profile | 프로필 |
| ⚑ pricing | `pricing_page_subtitle` | Browse credit packs freely. Guests can explore all plans — sign in only when you are ready to purchase. | 크레딧 패키지를 자유롭게 둘러보세요. 게스트도 모든 요금제를 볼 수 있으며, 구매할 준비가 되었을 때만 로그인하면 됩니다. |
| ⚑ pricing | `pricing_page_title` | Pricing | 요금제 |
|  | `profile_admin_badge` | Admin | 관리자 |
|  | `profile_badge` | User Profile | 사용자 프로필 |
|  | `profile_cancel` | Cancel | 취소 |
| ⚑ billing | `profile_dashboard_hint` | View credits and billing history on your dashboard. | 크레딧과 결제 내역은 대시보드에서 확인하세요. |
|  | `profile_dob` | Date of Birth | 생년월일 |
|  | `profile_edit_button` | Edit Profile | 프로필 편집 |
|  | `profile_email_readonly` | Email cannot be changed here. | 이메일은 여기에서 변경할 수 없습니다. |
|  | `profile_first_name` | First Name | 이름 |
|  | `profile_last_name` | Last Name | 성 |
|  | `profile_load_failed` | Profile could not be loaded. | 프로필을 불러올 수 없습니다. |
|  | `profile_member_since` | Member Since | 가입일 |
|  | `profile_retry` | Try again | 다시 시도 |
|  | `profile_save_button` | Save Changes | 변경 사항 저장 |
|  | `profile_save_failed` | Profile could not be updated. | 프로필을 업데이트할 수 없습니다. |
|  | `profile_save_success` | Profile updated successfully. | 프로필이 업데이트되었습니다. |
|  | `profile_saving` | Saving… | 저장 중… |
|  | `profile_subtitle` | Manage your personal details and keep your MoleculeStudio identity up to date. | 개인 정보를 관리하고 MoleculeStudio 프로필을 최신 상태로 유지하세요. |
|  | `profile_title` | Your Profile | 내 프로필 |

## ja — 日本語

| Priority | Key | English | Translation |
| --- | --- | --- | --- |
| ⚑ billing | `auth_credits_label` | Credits | クレジット |
|  | `auth_dob_label` | Date of Birth | 生年月日 |
|  | `auth_email_label` | Email | メールアドレス |
|  | `auth_error_generic` | Request could not be completed. | リクエストを完了できませんでした。 |
|  | `auth_error_invalid` | Invalid credentials. | 認証情報が正しくありません。 |
|  | `auth_first_name_label` | First Name | 名 |
|  | `auth_google_button` | Sign in with Google | Google でログイン |
|  | `auth_google_divider` | or continue with email | またはメールアドレスで続行 |
|  | `auth_google_unavailable` | Google sign-in is not configured for this environment. | この環境では Google ログインが設定されていません。 |
|  | `auth_last_name_label` | Last Name | 姓 |
|  | `auth_loading` | Please wait… | お待ちください… |
|  | `auth_login_button` | Log In | ログイン |
|  | `auth_login_title` | Sign in to your lab | ラボにログイン |
|  | `auth_logout` | Logout | ログアウト |
|  | `auth_modal_subtitle` | Access AI structure generation and credit balance | AI による構造生成とクレジット残高にアクセス |
|  | `auth_password_label` | Password | パスワード |
|  | `auth_register_button` | Sign Up | 新規登録 |
|  | `auth_register_title` | Create your account | アカウントを作成 |
| ⚑ legal | `auth_signup_bonus` | New accounts receive 10 starter AI credits. | 新規アカウントには AI スタータークレジットが 10 付与されます。 |
|  | `auth_submit_login` | Log In | ログイン |
|  | `auth_submit_register` | Create Account | アカウントを作成 |
|  | `auth_tab_login` | Log In | ログイン |
|  | `auth_tab_register` | Sign Up | 新規登録 |
|  | `auth_val_dob` | Enter a valid date of birth. | 有効な生年月日を入力してください。 |
|  | `auth_val_email_invalid` | Enter a valid email address. | 有効なメールアドレスを入力してください。 |
|  | `auth_val_email_required` | Email is required. | メールアドレスは必須です。 |
|  | `auth_val_first_name` | First name is required. | 名は必須です。 |
|  | `auth_val_last_name` | Last name is required. | 姓は必須です。 |
|  | `auth_val_password_length` | Password must be at least 8 characters. | パスワードは 8 文字以上にしてください。 |
|  | `auth_val_password_letter` | Password must include a letter. | パスワードには英字を含めてください。 |
|  | `auth_val_password_number` | Password must include a number. | パスワードには数字を含めてください。 |
|  | `auth_val_password_required` | Password is required. | パスワードは必須です。 |
| ⚑ pricing | `billing_best_value` | Best Value | いちばんお得 |
| ⚑ legal | `billing_buy_now` | Buy Now | 今すぐ購入 |
| ⚑ pricing | `billing_credits_unit` | credits | クレジット |
| ⚑ billing | `billing_current_balance` | Current balance | 現在の残高 |
| ⚑ pricing | `billing_feature_3d` | 3D molecule generation | 3D 分子生成 |
| ⚑ legal | `billing_feature_never_expire` | Credits never expire | クレジットに有効期限はありません |
| ⚑ pricing | `billing_get_started` | Get Started | はじめる |
| ⚑ billing | `billing_redirecting` | Redirecting… | リダイレクト中… |
| ⚑ legal | `billing_secure_note` | Lemon Squeezy MoR (USD) · Credits applied after verified webhook | Lemon Squeezy MoR (USD) · 検証済み Webhook の受信後にクレジットを反映 |
| ⚑ pricing | `billing_subtitle` | Buy AI credits securely with Lemon Squeezy. | Lemon Squeezy で AI クレジットを安全に購入できます。 |
| ⚑ pricing | `billing_title` | Purchase AI Credits | AI クレジットを購入 |
| ⚑ legal | `billing_via_lemon` | Paid via Lemon Squeezy (MoR) | Lemon Squeezy（MoR）で決済 |
|  | `dashboard_badge` | Account Dashboard | アカウントダッシュボード |
| ⚑ billing | `dashboard_balance_label` | AI Credits | AI クレジット |
| ⚑ billing | `dashboard_buy_credits` | Purchase more credits | クレジットを追加購入 |
| ⚑ billing | `dashboard_col_amount` | Amount | 数量 |
|  | `dashboard_col_date` | Date | 日付 |
|  | `dashboard_col_description` | Description | 内容 |
|  | `dashboard_col_reference` | Reference | 参照 |
|  | `dashboard_col_type` | Type | 種類 |
|  | `dashboard_email_label` | Signed in as | ログイン中のアカウント |
|  | `dashboard_empty_body` | Run your first AI structure generation to begin your ledger. | 最初の AI 構造生成を実行すると、取引履歴が始まります。 |
|  | `dashboard_empty_cta` | Open AI Lab | AI Lab を開く |
|  | `dashboard_empty_title` | No transactions yet | 取引はまだありません |
| ⚑ billing | `dashboard_history_title` | Credit & Usage History | クレジットと利用の履歴 |
|  | `dashboard_load_more` | Load more | さらに読み込む |
|  | `dashboard_quick_links` | Quick links | クイックリンク |
| ⚑ billing | `dashboard_subtitle` | Manage your AI credits and review your full transaction ledger. | AI クレジットを管理し、すべての取引履歴を確認できます。 |
|  | `dashboard_title` | Your MoleculeStudio Account | MoleculeStudio アカウント |
|  | `nav_dashboard` | Dashboard | ダッシュボード |
|  | `nav_pricing` | Pricing | 料金 |
|  | `nav_profile` | Profile | プロフィール |
| ⚑ pricing | `pricing_page_subtitle` | Browse credit packs freely. Guests can explore all plans — sign in only when you are ready to purchase. | クレジットパックを自由にご覧ください。ゲストもすべてのプランを確認できます。ログインは購入するときだけで大丈夫です。 |
| ⚑ pricing | `pricing_page_title` | Pricing | 料金 |
|  | `profile_admin_badge` | Admin | 管理者 |
|  | `profile_badge` | User Profile | ユーザープロフィール |
|  | `profile_cancel` | Cancel | キャンセル |
| ⚑ billing | `profile_dashboard_hint` | View credits and billing history on your dashboard. | クレジットと支払い履歴はダッシュボードで確認できます。 |
|  | `profile_dob` | Date of Birth | 生年月日 |
|  | `profile_edit_button` | Edit Profile | プロフィールを編集 |
|  | `profile_email_readonly` | Email cannot be changed here. | メールアドレスはここでは変更できません。 |
|  | `profile_first_name` | First Name | 名 |
|  | `profile_last_name` | Last Name | 姓 |
|  | `profile_load_failed` | Profile could not be loaded. | プロフィールを読み込めませんでした。 |
|  | `profile_member_since` | Member Since | 登録日 |
|  | `profile_retry` | Try again | 再試行 |
|  | `profile_save_button` | Save Changes | 変更を保存 |
|  | `profile_save_failed` | Profile could not be updated. | プロフィールを更新できませんでした。 |
|  | `profile_save_success` | Profile updated successfully. | プロフィールを更新しました。 |
|  | `profile_saving` | Saving… | 保存中… |
|  | `profile_subtitle` | Manage your personal details and keep your MoleculeStudio identity up to date. | 個人情報を管理し、MoleculeStudio のプロフィールを最新の状態に保ちましょう。 |
|  | `profile_title` | Your Profile | プロフィール |

## fr — Français

| Priority | Key | English | Translation |
| --- | --- | --- | --- |
| ⚑ billing | `auth_credits_label` | Credits | Crédits |
|  | `auth_dob_label` | Date of Birth | Date de naissance |
|  | `auth_email_label` | Email | E-mail |
|  | `auth_error_generic` | Request could not be completed. | La requête n'a pas pu aboutir. |
|  | `auth_error_invalid` | Invalid credentials. | Identifiants invalides. |
|  | `auth_first_name_label` | First Name | Prénom |
|  | `auth_google_button` | Sign in with Google | Se connecter avec Google |
|  | `auth_google_divider` | or continue with email | ou continuer avec l'e-mail |
|  | `auth_google_unavailable` | Google sign-in is not configured for this environment. | La connexion Google n'est pas configurée dans cet environnement. |
|  | `auth_last_name_label` | Last Name | Nom |
|  | `auth_loading` | Please wait… | Veuillez patienter… |
|  | `auth_login_button` | Log In | Se connecter |
|  | `auth_login_title` | Sign in to your lab | Connectez-vous à votre laboratoire |
|  | `auth_logout` | Logout | Se déconnecter |
|  | `auth_modal_subtitle` | Access AI structure generation and credit balance | Accédez à la génération de structures par IA et à votre solde de crédits |
|  | `auth_password_label` | Password | Mot de passe |
|  | `auth_register_button` | Sign Up | S'inscrire |
|  | `auth_register_title` | Create your account | Créez votre compte |
| ⚑ legal | `auth_signup_bonus` | New accounts receive 10 starter AI credits. | Les nouveaux comptes reçoivent 10 crédits IA de bienvenue. |
|  | `auth_submit_login` | Log In | Se connecter |
|  | `auth_submit_register` | Create Account | Créer un compte |
|  | `auth_tab_login` | Log In | Connexion |
|  | `auth_tab_register` | Sign Up | Inscription |
|  | `auth_val_dob` | Enter a valid date of birth. | Saisissez une date de naissance valide. |
|  | `auth_val_email_invalid` | Enter a valid email address. | Saisissez une adresse e-mail valide. |
|  | `auth_val_email_required` | Email is required. | L'e-mail est obligatoire. |
|  | `auth_val_first_name` | First name is required. | Le prénom est obligatoire. |
|  | `auth_val_last_name` | Last name is required. | Le nom est obligatoire. |
|  | `auth_val_password_length` | Password must be at least 8 characters. | Le mot de passe doit contenir au moins 8 caractères. |
|  | `auth_val_password_letter` | Password must include a letter. | Le mot de passe doit contenir une lettre. |
|  | `auth_val_password_number` | Password must include a number. | Le mot de passe doit contenir un chiffre. |
|  | `auth_val_password_required` | Password is required. | Le mot de passe est obligatoire. |
| ⚑ pricing | `billing_best_value` | Best Value | Meilleure offre |
| ⚑ legal | `billing_buy_now` | Buy Now | Acheter |
| ⚑ pricing | `billing_credits_unit` | credits | crédits |
| ⚑ billing | `billing_current_balance` | Current balance | Solde actuel |
| ⚑ pricing | `billing_feature_3d` | 3D molecule generation | Génération de molécules en 3D |
| ⚑ legal | `billing_feature_never_expire` | Credits never expire | Les crédits n'expirent jamais |
| ⚑ pricing | `billing_get_started` | Get Started | Commencer |
| ⚑ billing | `billing_redirecting` | Redirecting… | Redirection… |
| ⚑ legal | `billing_secure_note` | Lemon Squeezy MoR (USD) · Credits applied after verified webhook | Lemon Squeezy MoR (USD) · Crédits ajoutés après un webhook vérifié |
| ⚑ pricing | `billing_subtitle` | Buy AI credits securely with Lemon Squeezy. | Achetez des crédits IA en toute sécurité avec Lemon Squeezy. |
| ⚑ pricing | `billing_title` | Purchase AI Credits | Acheter des crédits IA |
| ⚑ legal | `billing_via_lemon` | Paid via Lemon Squeezy (MoR) | Payé via Lemon Squeezy (MoR) |
|  | `dashboard_badge` | Account Dashboard | Tableau de bord du compte |
| ⚑ billing | `dashboard_balance_label` | AI Credits | Crédits IA |
| ⚑ billing | `dashboard_buy_credits` | Purchase more credits | Acheter plus de crédits |
| ⚑ billing | `dashboard_col_amount` | Amount | Montant |
|  | `dashboard_col_date` | Date | Date |
|  | `dashboard_col_description` | Description | Description |
|  | `dashboard_col_reference` | Reference | Référence |
|  | `dashboard_col_type` | Type | Type |
|  | `dashboard_email_label` | Signed in as | Connecté en tant que |
|  | `dashboard_empty_body` | Run your first AI structure generation to begin your ledger. | Lancez votre première génération de structure par IA pour démarrer votre historique. |
|  | `dashboard_empty_cta` | Open AI Lab | Ouvrir l'AI Lab |
|  | `dashboard_empty_title` | No transactions yet | Aucune transaction pour l'instant |
| ⚑ billing | `dashboard_history_title` | Credit & Usage History | Historique des crédits et de l'utilisation |
|  | `dashboard_load_more` | Load more | Afficher plus |
|  | `dashboard_quick_links` | Quick links | Liens rapides |
| ⚑ billing | `dashboard_subtitle` | Manage your AI credits and review your full transaction ledger. | Gérez vos crédits IA et consultez l'historique complet de vos transactions. |
|  | `dashboard_title` | Your MoleculeStudio Account | Votre compte MoleculeStudio |
|  | `nav_dashboard` | Dashboard | Tableau de bord |
|  | `nav_pricing` | Pricing | Tarifs |
|  | `nav_profile` | Profile | Profil |
| ⚑ pricing | `pricing_page_subtitle` | Browse credit packs freely. Guests can explore all plans — sign in only when you are ready to purchase. | Parcourez librement les packs de crédits. Les visiteurs peuvent consulter toutes les offres — connectez-vous seulement au moment d'acheter. |
| ⚑ pricing | `pricing_page_title` | Pricing | Tarifs |
|  | `profile_admin_badge` | Admin | Administrateur |
|  | `profile_badge` | User Profile | Profil utilisateur |
|  | `profile_cancel` | Cancel | Annuler |
| ⚑ billing | `profile_dashboard_hint` | View credits and billing history on your dashboard. | Consultez vos crédits et votre historique de paiement dans le tableau de bord. |
|  | `profile_dob` | Date of Birth | Date de naissance |
|  | `profile_edit_button` | Edit Profile | Modifier le profil |
|  | `profile_email_readonly` | Email cannot be changed here. | L'adresse e-mail ne peut pas être modifiée ici. |
|  | `profile_first_name` | First Name | Prénom |
|  | `profile_last_name` | Last Name | Nom |
|  | `profile_load_failed` | Profile could not be loaded. | Impossible de charger le profil. |
|  | `profile_member_since` | Member Since | Membre depuis |
|  | `profile_retry` | Try again | Réessayer |
|  | `profile_save_button` | Save Changes | Enregistrer les modifications |
|  | `profile_save_failed` | Profile could not be updated. | Impossible de mettre à jour le profil. |
|  | `profile_save_success` | Profile updated successfully. | Profil mis à jour. |
|  | `profile_saving` | Saving… | Enregistrement… |
|  | `profile_subtitle` | Manage your personal details and keep your MoleculeStudio identity up to date. | Gérez vos informations personnelles et gardez votre identité MoleculeStudio à jour. |
|  | `profile_title` | Your Profile | Votre profil |

## ru — Русский

| Priority | Key | English | Translation |
| --- | --- | --- | --- |
| ⚑ billing | `auth_credits_label` | Credits | Кредиты |
|  | `auth_dob_label` | Date of Birth | Дата рождения |
|  | `auth_email_label` | Email | Эл. почта |
|  | `auth_error_generic` | Request could not be completed. | Не удалось выполнить запрос. |
|  | `auth_error_invalid` | Invalid credentials. | Неверные учётные данные. |
|  | `auth_first_name_label` | First Name | Имя |
|  | `auth_google_button` | Sign in with Google | Войти через Google |
|  | `auth_google_divider` | or continue with email | или продолжите с эл. почтой |
|  | `auth_google_unavailable` | Google sign-in is not configured for this environment. | Вход через Google не настроен в этой среде. |
|  | `auth_last_name_label` | Last Name | Фамилия |
|  | `auth_loading` | Please wait… | Подождите… |
|  | `auth_login_button` | Log In | Войти |
|  | `auth_login_title` | Sign in to your lab | Вход в вашу лабораторию |
|  | `auth_logout` | Logout | Выйти |
|  | `auth_modal_subtitle` | Access AI structure generation and credit balance | Доступ к генерации структур с помощью ИИ и балансу кредитов |
|  | `auth_password_label` | Password | Пароль |
|  | `auth_register_button` | Sign Up | Регистрация |
|  | `auth_register_title` | Create your account | Создайте аккаунт |
| ⚑ legal | `auth_signup_bonus` | New accounts receive 10 starter AI credits. | Новые аккаунты получают 10 стартовых ИИ-кредитов. |
|  | `auth_submit_login` | Log In | Войти |
|  | `auth_submit_register` | Create Account | Создать аккаунт |
|  | `auth_tab_login` | Log In | Вход |
|  | `auth_tab_register` | Sign Up | Регистрация |
|  | `auth_val_dob` | Enter a valid date of birth. | Введите корректную дату рождения. |
|  | `auth_val_email_invalid` | Enter a valid email address. | Введите корректный адрес эл. почты. |
|  | `auth_val_email_required` | Email is required. | Укажите адрес эл. почты. |
|  | `auth_val_first_name` | First name is required. | Укажите имя. |
|  | `auth_val_last_name` | Last name is required. | Укажите фамилию. |
|  | `auth_val_password_length` | Password must be at least 8 characters. | Пароль должен содержать не менее 8 символов. |
|  | `auth_val_password_letter` | Password must include a letter. | Пароль должен содержать букву. |
|  | `auth_val_password_number` | Password must include a number. | Пароль должен содержать цифру. |
|  | `auth_val_password_required` | Password is required. | Введите пароль. |
| ⚑ pricing | `billing_best_value` | Best Value | Самый выгодный |
| ⚑ legal | `billing_buy_now` | Buy Now | Купить сейчас |
| ⚑ pricing | `billing_credits_unit` | credits | кредитов |
| ⚑ billing | `billing_current_balance` | Current balance | Текущий баланс |
| ⚑ pricing | `billing_feature_3d` | 3D molecule generation | Генерация 3D-молекул |
| ⚑ legal | `billing_feature_never_expire` | Credits never expire | Кредиты не сгорают |
| ⚑ pricing | `billing_get_started` | Get Started | Начать |
| ⚑ billing | `billing_redirecting` | Redirecting… | Перенаправление… |
| ⚑ legal | `billing_secure_note` | Lemon Squeezy MoR (USD) · Credits applied after verified webhook | Lemon Squeezy MoR (USD) · Кредиты зачисляются после проверенного вебхука |
| ⚑ pricing | `billing_subtitle` | Buy AI credits securely with Lemon Squeezy. | Безопасно покупайте ИИ-кредиты через Lemon Squeezy. |
| ⚑ pricing | `billing_title` | Purchase AI Credits | Покупка ИИ-кредитов |
| ⚑ legal | `billing_via_lemon` | Paid via Lemon Squeezy (MoR) | Оплата через Lemon Squeezy (MoR) |
|  | `dashboard_badge` | Account Dashboard | Панель аккаунта |
| ⚑ billing | `dashboard_balance_label` | AI Credits | ИИ-кредиты |
| ⚑ billing | `dashboard_buy_credits` | Purchase more credits | Купить ещё кредиты |
| ⚑ billing | `dashboard_col_amount` | Amount | Сумма |
|  | `dashboard_col_date` | Date | Дата |
|  | `dashboard_col_description` | Description | Описание |
|  | `dashboard_col_reference` | Reference | Ссылка |
|  | `dashboard_col_type` | Type | Тип |
|  | `dashboard_email_label` | Signed in as | Вы вошли как |
|  | `dashboard_empty_body` | Run your first AI structure generation to begin your ledger. | Запустите первую генерацию структуры с помощью ИИ, чтобы начать историю операций. |
|  | `dashboard_empty_cta` | Open AI Lab | Открыть AI Lab |
|  | `dashboard_empty_title` | No transactions yet | Операций пока нет |
| ⚑ billing | `dashboard_history_title` | Credit & Usage History | История кредитов и использования |
|  | `dashboard_load_more` | Load more | Показать ещё |
|  | `dashboard_quick_links` | Quick links | Быстрые ссылки |
| ⚑ billing | `dashboard_subtitle` | Manage your AI credits and review your full transaction ledger. | Управляйте ИИ-кредитами и просматривайте полную историю операций. |
|  | `dashboard_title` | Your MoleculeStudio Account | Ваш аккаунт MoleculeStudio |
|  | `nav_dashboard` | Dashboard | Панель |
|  | `nav_pricing` | Pricing | Цены |
|  | `nav_profile` | Profile | Профиль |
| ⚑ pricing | `pricing_page_subtitle` | Browse credit packs freely. Guests can explore all plans — sign in only when you are ready to purchase. | Свободно просматривайте пакеты кредитов. Гости могут изучить все тарифы — входите, только когда будете готовы к покупке. |
| ⚑ pricing | `pricing_page_title` | Pricing | Цены |
|  | `profile_admin_badge` | Admin | Администратор |
|  | `profile_badge` | User Profile | Профиль пользователя |
|  | `profile_cancel` | Cancel | Отмена |
| ⚑ billing | `profile_dashboard_hint` | View credits and billing history on your dashboard. | Кредиты и историю платежей смотрите на панели. |
|  | `profile_dob` | Date of Birth | Дата рождения |
|  | `profile_edit_button` | Edit Profile | Редактировать профиль |
|  | `profile_email_readonly` | Email cannot be changed here. | Адрес эл. почты здесь изменить нельзя. |
|  | `profile_first_name` | First Name | Имя |
|  | `profile_last_name` | Last Name | Фамилия |
|  | `profile_load_failed` | Profile could not be loaded. | Не удалось загрузить профиль. |
|  | `profile_member_since` | Member Since | Участник с |
|  | `profile_retry` | Try again | Повторить |
|  | `profile_save_button` | Save Changes | Сохранить изменения |
|  | `profile_save_failed` | Profile could not be updated. | Не удалось обновить профиль. |
|  | `profile_save_success` | Profile updated successfully. | Профиль обновлён. |
|  | `profile_saving` | Saving… | Сохранение… |
|  | `profile_subtitle` | Manage your personal details and keep your MoleculeStudio identity up to date. | Управляйте личными данными и поддерживайте профиль MoleculeStudio в актуальном состоянии. |
|  | `profile_title` | Your Profile | Ваш профиль |

## zh — 汉语

| Priority | Key | English | Translation |
| --- | --- | --- | --- |
| ⚑ billing | `auth_credits_label` | Credits | 积分 |
|  | `auth_dob_label` | Date of Birth | 出生日期 |
|  | `auth_email_label` | Email | 电子邮箱 |
|  | `auth_error_generic` | Request could not be completed. | 请求未能完成。 |
|  | `auth_error_invalid` | Invalid credentials. | 凭据无效。 |
|  | `auth_first_name_label` | First Name | 名 |
|  | `auth_google_button` | Sign in with Google | 使用 Google 登录 |
|  | `auth_google_divider` | or continue with email | 或使用电子邮箱继续 |
|  | `auth_google_unavailable` | Google sign-in is not configured for this environment. | 当前环境未配置 Google 登录。 |
|  | `auth_last_name_label` | Last Name | 姓 |
|  | `auth_loading` | Please wait… | 请稍候… |
|  | `auth_login_button` | Log In | 登录 |
|  | `auth_login_title` | Sign in to your lab | 登录你的实验室 |
|  | `auth_logout` | Logout | 退出登录 |
|  | `auth_modal_subtitle` | Access AI structure generation and credit balance | 使用 AI 结构生成并查看积分余额 |
|  | `auth_password_label` | Password | 密码 |
|  | `auth_register_button` | Sign Up | 注册 |
|  | `auth_register_title` | Create your account | 创建账户 |
| ⚑ legal | `auth_signup_bonus` | New accounts receive 10 starter AI credits. | 新账户可获得 10 个 AI 入门积分。 |
|  | `auth_submit_login` | Log In | 登录 |
|  | `auth_submit_register` | Create Account | 创建账户 |
|  | `auth_tab_login` | Log In | 登录 |
|  | `auth_tab_register` | Sign Up | 注册 |
|  | `auth_val_dob` | Enter a valid date of birth. | 请输入有效的出生日期。 |
|  | `auth_val_email_invalid` | Enter a valid email address. | 请输入有效的电子邮箱地址。 |
|  | `auth_val_email_required` | Email is required. | 请填写电子邮箱。 |
|  | `auth_val_first_name` | First name is required. | 请填写名。 |
|  | `auth_val_last_name` | Last name is required. | 请填写姓。 |
|  | `auth_val_password_length` | Password must be at least 8 characters. | 密码至少需要 8 个字符。 |
|  | `auth_val_password_letter` | Password must include a letter. | 密码必须包含字母。 |
|  | `auth_val_password_number` | Password must include a number. | 密码必须包含数字。 |
|  | `auth_val_password_required` | Password is required. | 请填写密码。 |
| ⚑ pricing | `billing_best_value` | Best Value | 最超值 |
| ⚑ legal | `billing_buy_now` | Buy Now | 立即购买 |
| ⚑ pricing | `billing_credits_unit` | credits | 积分 |
| ⚑ billing | `billing_current_balance` | Current balance | 当前余额 |
| ⚑ pricing | `billing_feature_3d` | 3D molecule generation | 3D 分子生成 |
| ⚑ legal | `billing_feature_never_expire` | Credits never expire | 积分永不过期 |
| ⚑ pricing | `billing_get_started` | Get Started | 开始使用 |
| ⚑ billing | `billing_redirecting` | Redirecting… | 正在跳转… |
| ⚑ legal | `billing_secure_note` | Lemon Squeezy MoR (USD) · Credits applied after verified webhook | Lemon Squeezy MoR（USD）· Webhook 验证后发放积分 |
| ⚑ pricing | `billing_subtitle` | Buy AI credits securely with Lemon Squeezy. | 通过 Lemon Squeezy 安全购买 AI 积分。 |
| ⚑ pricing | `billing_title` | Purchase AI Credits | 购买 AI 积分 |
| ⚑ legal | `billing_via_lemon` | Paid via Lemon Squeezy (MoR) | 通过 Lemon Squeezy（MoR）支付 |
|  | `dashboard_badge` | Account Dashboard | 账户控制台 |
| ⚑ billing | `dashboard_balance_label` | AI Credits | AI 积分 |
| ⚑ billing | `dashboard_buy_credits` | Purchase more credits | 购买更多积分 |
| ⚑ billing | `dashboard_col_amount` | Amount | 数量 |
|  | `dashboard_col_date` | Date | 日期 |
|  | `dashboard_col_description` | Description | 说明 |
|  | `dashboard_col_reference` | Reference | 参考编号 |
|  | `dashboard_col_type` | Type | 类型 |
|  | `dashboard_email_label` | Signed in as | 当前登录 |
|  | `dashboard_empty_body` | Run your first AI structure generation to begin your ledger. | 运行你的第一次 AI 结构生成，即可开始记录交易明细。 |
|  | `dashboard_empty_cta` | Open AI Lab | 打开 AI Lab |
|  | `dashboard_empty_title` | No transactions yet | 暂无交易 |
| ⚑ billing | `dashboard_history_title` | Credit & Usage History | 积分与使用记录 |
|  | `dashboard_load_more` | Load more | 加载更多 |
|  | `dashboard_quick_links` | Quick links | 快捷链接 |
| ⚑ billing | `dashboard_subtitle` | Manage your AI credits and review your full transaction ledger. | 管理你的 AI 积分并查看完整的交易明细。 |
|  | `dashboard_title` | Your MoleculeStudio Account | 你的 MoleculeStudio 账户 |
|  | `nav_dashboard` | Dashboard | 控制台 |
|  | `nav_pricing` | Pricing | 价格 |
|  | `nav_profile` | Profile | 个人资料 |
| ⚑ pricing | `pricing_page_subtitle` | Browse credit packs freely. Guests can explore all plans — sign in only when you are ready to purchase. | 自由浏览积分套餐。访客可查看所有方案——准备购买时再登录即可。 |
| ⚑ pricing | `pricing_page_title` | Pricing | 价格 |
|  | `profile_admin_badge` | Admin | 管理员 |
|  | `profile_badge` | User Profile | 用户资料 |
|  | `profile_cancel` | Cancel | 取消 |
| ⚑ billing | `profile_dashboard_hint` | View credits and billing history on your dashboard. | 在控制台查看积分和账单记录。 |
|  | `profile_dob` | Date of Birth | 出生日期 |
|  | `profile_edit_button` | Edit Profile | 编辑资料 |
|  | `profile_email_readonly` | Email cannot be changed here. | 此处无法更改电子邮箱。 |
|  | `profile_first_name` | First Name | 名 |
|  | `profile_last_name` | Last Name | 姓 |
|  | `profile_load_failed` | Profile could not be loaded. | 无法加载个人资料。 |
|  | `profile_member_since` | Member Since | 注册时间 |
|  | `profile_retry` | Try again | 重试 |
|  | `profile_save_button` | Save Changes | 保存更改 |
|  | `profile_save_failed` | Profile could not be updated. | 无法更新个人资料。 |
|  | `profile_save_success` | Profile updated successfully. | 个人资料已更新。 |
|  | `profile_saving` | Saving… | 正在保存… |
|  | `profile_subtitle` | Manage your personal details and keep your MoleculeStudio identity up to date. | 管理你的个人信息，让你的 MoleculeStudio 身份保持最新。 |
|  | `profile_title` | Your Profile | 你的个人资料 |

## it — Italiano

| Priority | Key | English | Translation |
| --- | --- | --- | --- |
| ⚑ billing | `auth_credits_label` | Credits | Crediti |
|  | `auth_dob_label` | Date of Birth | Data di nascita |
|  | `auth_email_label` | Email | Email |
|  | `auth_error_generic` | Request could not be completed. | Impossibile completare la richiesta. |
|  | `auth_error_invalid` | Invalid credentials. | Credenziali non valide. |
|  | `auth_first_name_label` | First Name | Nome |
|  | `auth_google_button` | Sign in with Google | Accedi con Google |
|  | `auth_google_divider` | or continue with email | oppure continua con l'email |
|  | `auth_google_unavailable` | Google sign-in is not configured for this environment. | L'accesso con Google non è configurato in questo ambiente. |
|  | `auth_last_name_label` | Last Name | Cognome |
|  | `auth_loading` | Please wait… | Attendi… |
|  | `auth_login_button` | Log In | Accedi |
|  | `auth_login_title` | Sign in to your lab | Accedi al tuo laboratorio |
|  | `auth_logout` | Logout | Esci |
|  | `auth_modal_subtitle` | Access AI structure generation and credit balance | Accedi alla generazione di strutture con l'IA e al tuo saldo crediti |
|  | `auth_password_label` | Password | Password |
|  | `auth_register_button` | Sign Up | Registrati |
|  | `auth_register_title` | Create your account | Crea il tuo account |
| ⚑ legal | `auth_signup_bonus` | New accounts receive 10 starter AI credits. | I nuovi account ricevono 10 crediti IA di benvenuto. |
|  | `auth_submit_login` | Log In | Accedi |
|  | `auth_submit_register` | Create Account | Crea account |
|  | `auth_tab_login` | Log In | Accedi |
|  | `auth_tab_register` | Sign Up | Registrati |
|  | `auth_val_dob` | Enter a valid date of birth. | Inserisci una data di nascita valida. |
|  | `auth_val_email_invalid` | Enter a valid email address. | Inserisci un indirizzo email valido. |
|  | `auth_val_email_required` | Email is required. | L'email è obbligatoria. |
|  | `auth_val_first_name` | First name is required. | Il nome è obbligatorio. |
|  | `auth_val_last_name` | Last name is required. | Il cognome è obbligatorio. |
|  | `auth_val_password_length` | Password must be at least 8 characters. | La password deve contenere almeno 8 caratteri. |
|  | `auth_val_password_letter` | Password must include a letter. | La password deve contenere una lettera. |
|  | `auth_val_password_number` | Password must include a number. | La password deve contenere un numero. |
|  | `auth_val_password_required` | Password is required. | La password è obbligatoria. |
| ⚑ pricing | `billing_best_value` | Best Value | Più conveniente |
| ⚑ legal | `billing_buy_now` | Buy Now | Acquista ora |
| ⚑ pricing | `billing_credits_unit` | credits | crediti |
| ⚑ billing | `billing_current_balance` | Current balance | Saldo attuale |
| ⚑ pricing | `billing_feature_3d` | 3D molecule generation | Generazione di molecole in 3D |
| ⚑ legal | `billing_feature_never_expire` | Credits never expire | I crediti non scadono mai |
| ⚑ pricing | `billing_get_started` | Get Started | Inizia |
| ⚑ billing | `billing_redirecting` | Redirecting… | Reindirizzamento… |
| ⚑ legal | `billing_secure_note` | Lemon Squeezy MoR (USD) · Credits applied after verified webhook | Lemon Squeezy MoR (USD) · Crediti accreditati dopo un webhook verificato |
| ⚑ pricing | `billing_subtitle` | Buy AI credits securely with Lemon Squeezy. | Acquista crediti IA in modo sicuro con Lemon Squeezy. |
| ⚑ pricing | `billing_title` | Purchase AI Credits | Acquista crediti IA |
| ⚑ legal | `billing_via_lemon` | Paid via Lemon Squeezy (MoR) | Pagato tramite Lemon Squeezy (MoR) |
|  | `dashboard_badge` | Account Dashboard | Dashboard dell'account |
| ⚑ billing | `dashboard_balance_label` | AI Credits | Crediti IA |
| ⚑ billing | `dashboard_buy_credits` | Purchase more credits | Acquista altri crediti |
| ⚑ billing | `dashboard_col_amount` | Amount | Importo |
|  | `dashboard_col_date` | Date | Data |
|  | `dashboard_col_description` | Description | Descrizione |
|  | `dashboard_col_reference` | Reference | Riferimento |
|  | `dashboard_col_type` | Type | Tipo |
|  | `dashboard_email_label` | Signed in as | Accesso effettuato come |
|  | `dashboard_empty_body` | Run your first AI structure generation to begin your ledger. | Avvia la tua prima generazione di strutture con l'IA per iniziare lo storico. |
|  | `dashboard_empty_cta` | Open AI Lab | Apri AI Lab |
|  | `dashboard_empty_title` | No transactions yet | Ancora nessuna transazione |
| ⚑ billing | `dashboard_history_title` | Credit & Usage History | Storico crediti e utilizzo |
|  | `dashboard_load_more` | Load more | Carica altro |
|  | `dashboard_quick_links` | Quick links | Link rapidi |
| ⚑ billing | `dashboard_subtitle` | Manage your AI credits and review your full transaction ledger. | Gestisci i tuoi crediti IA e consulta lo storico completo delle transazioni. |
|  | `dashboard_title` | Your MoleculeStudio Account | Il tuo account MoleculeStudio |
|  | `nav_dashboard` | Dashboard | Pannello |
|  | `nav_pricing` | Pricing | Prezzi |
|  | `nav_profile` | Profile | Profilo |
| ⚑ pricing | `pricing_page_subtitle` | Browse credit packs freely. Guests can explore all plans — sign in only when you are ready to purchase. | Sfoglia liberamente i pacchetti di crediti. Gli ospiti possono vedere tutti i piani: accedi solo quando sei pronto ad acquistare. |
| ⚑ pricing | `pricing_page_title` | Pricing | Prezzi |
|  | `profile_admin_badge` | Admin | Amministratore |
|  | `profile_badge` | User Profile | Profilo utente |
|  | `profile_cancel` | Cancel | Annulla |
| ⚑ billing | `profile_dashboard_hint` | View credits and billing history on your dashboard. | Consulta crediti e storico dei pagamenti nel pannello. |
|  | `profile_dob` | Date of Birth | Data di nascita |
|  | `profile_edit_button` | Edit Profile | Modifica profilo |
|  | `profile_email_readonly` | Email cannot be changed here. | L'email non può essere modificata qui. |
|  | `profile_first_name` | First Name | Nome |
|  | `profile_last_name` | Last Name | Cognome |
|  | `profile_load_failed` | Profile could not be loaded. | Impossibile caricare il profilo. |
|  | `profile_member_since` | Member Since | Membro dal |
|  | `profile_retry` | Try again | Riprova |
|  | `profile_save_button` | Save Changes | Salva modifiche |
|  | `profile_save_failed` | Profile could not be updated. | Impossibile aggiornare il profilo. |
|  | `profile_save_success` | Profile updated successfully. | Profilo aggiornato. |
|  | `profile_saving` | Saving… | Salvataggio… |
|  | `profile_subtitle` | Manage your personal details and keep your MoleculeStudio identity up to date. | Gestisci i tuoi dati personali e mantieni aggiornata la tua identità MoleculeStudio. |
|  | `profile_title` | Your Profile | Il tuo profilo |

## hi — हिन्दी

| Priority | Key | English | Translation |
| --- | --- | --- | --- |
| ⚑ billing | `auth_credits_label` | Credits | क्रेडिट |
|  | `auth_dob_label` | Date of Birth | जन्म तिथि |
|  | `auth_email_label` | Email | ईमेल |
|  | `auth_error_generic` | Request could not be completed. | अनुरोध पूरा नहीं हो सका। |
|  | `auth_error_invalid` | Invalid credentials. | अमान्य लॉगिन विवरण। |
|  | `auth_first_name_label` | First Name | पहला नाम |
|  | `auth_google_button` | Sign in with Google | Google से साइन इन करें |
|  | `auth_google_divider` | or continue with email | या ईमेल से जारी रखें |
|  | `auth_google_unavailable` | Google sign-in is not configured for this environment. | इस परिवेश में Google साइन-इन कॉन्फ़िगर नहीं है। |
|  | `auth_last_name_label` | Last Name | उपनाम |
|  | `auth_loading` | Please wait… | कृपया प्रतीक्षा करें… |
|  | `auth_login_button` | Log In | लॉग इन |
|  | `auth_login_title` | Sign in to your lab | अपनी लैब में साइन इन करें |
|  | `auth_logout` | Logout | लॉग आउट |
|  | `auth_modal_subtitle` | Access AI structure generation and credit balance | AI संरचना निर्माण और अपने क्रेडिट बैलेंस तक पहुँचें |
|  | `auth_password_label` | Password | पासवर्ड |
|  | `auth_register_button` | Sign Up | साइन अप |
|  | `auth_register_title` | Create your account | अपना खाता बनाएँ |
| ⚑ legal | `auth_signup_bonus` | New accounts receive 10 starter AI credits. | नए खातों को 10 AI स्टार्टर क्रेडिट मिलते हैं। |
|  | `auth_submit_login` | Log In | लॉग इन |
|  | `auth_submit_register` | Create Account | खाता बनाएँ |
|  | `auth_tab_login` | Log In | लॉग इन |
|  | `auth_tab_register` | Sign Up | साइन अप |
|  | `auth_val_dob` | Enter a valid date of birth. | मान्य जन्म तिथि दर्ज करें। |
|  | `auth_val_email_invalid` | Enter a valid email address. | मान्य ईमेल पता दर्ज करें। |
|  | `auth_val_email_required` | Email is required. | ईमेल आवश्यक है। |
|  | `auth_val_first_name` | First name is required. | पहला नाम आवश्यक है। |
|  | `auth_val_last_name` | Last name is required. | उपनाम आवश्यक है। |
|  | `auth_val_password_length` | Password must be at least 8 characters. | पासवर्ड कम से कम 8 अक्षरों का होना चाहिए। |
|  | `auth_val_password_letter` | Password must include a letter. | पासवर्ड में कम से कम एक अक्षर होना चाहिए। |
|  | `auth_val_password_number` | Password must include a number. | पासवर्ड में कम से कम एक अंक होना चाहिए। |
|  | `auth_val_password_required` | Password is required. | पासवर्ड आवश्यक है। |
| ⚑ pricing | `billing_best_value` | Best Value | सबसे किफ़ायती |
| ⚑ legal | `billing_buy_now` | Buy Now | अभी खरीदें |
| ⚑ pricing | `billing_credits_unit` | credits | क्रेडिट |
| ⚑ billing | `billing_current_balance` | Current balance | वर्तमान बैलेंस |
| ⚑ pricing | `billing_feature_3d` | 3D molecule generation | 3D अणु निर्माण |
| ⚑ legal | `billing_feature_never_expire` | Credits never expire | क्रेडिट कभी समाप्त नहीं होते |
| ⚑ pricing | `billing_get_started` | Get Started | शुरू करें |
| ⚑ billing | `billing_redirecting` | Redirecting… | रीडायरेक्ट हो रहा है… |
| ⚑ legal | `billing_secure_note` | Lemon Squeezy MoR (USD) · Credits applied after verified webhook | Lemon Squeezy MoR (USD) · सत्यापित वेबहुक के बाद क्रेडिट जोड़े जाते हैं |
| ⚑ pricing | `billing_subtitle` | Buy AI credits securely with Lemon Squeezy. | Lemon Squeezy के साथ AI क्रेडिट सुरक्षित रूप से खरीदें। |
| ⚑ pricing | `billing_title` | Purchase AI Credits | AI क्रेडिट खरीदें |
| ⚑ legal | `billing_via_lemon` | Paid via Lemon Squeezy (MoR) | Lemon Squeezy (MoR) के माध्यम से भुगतान |
|  | `dashboard_badge` | Account Dashboard | खाता डैशबोर्ड |
| ⚑ billing | `dashboard_balance_label` | AI Credits | AI क्रेडिट |
| ⚑ billing | `dashboard_buy_credits` | Purchase more credits | और क्रेडिट खरीदें |
| ⚑ billing | `dashboard_col_amount` | Amount | राशि |
|  | `dashboard_col_date` | Date | तिथि |
|  | `dashboard_col_description` | Description | विवरण |
|  | `dashboard_col_reference` | Reference | संदर्भ |
|  | `dashboard_col_type` | Type | प्रकार |
|  | `dashboard_email_label` | Signed in as | इस रूप में साइन इन |
|  | `dashboard_empty_body` | Run your first AI structure generation to begin your ledger. | अपना लेन-देन इतिहास शुरू करने के लिए पहला AI संरचना निर्माण चलाएँ। |
|  | `dashboard_empty_cta` | Open AI Lab | AI Lab खोलें |
|  | `dashboard_empty_title` | No transactions yet | अभी तक कोई लेन-देन नहीं |
| ⚑ billing | `dashboard_history_title` | Credit & Usage History | क्रेडिट और उपयोग इतिहास |
|  | `dashboard_load_more` | Load more | और लोड करें |
|  | `dashboard_quick_links` | Quick links | त्वरित लिंक |
| ⚑ billing | `dashboard_subtitle` | Manage your AI credits and review your full transaction ledger. | अपने AI क्रेडिट प्रबंधित करें और पूरा लेन-देन इतिहास देखें। |
|  | `dashboard_title` | Your MoleculeStudio Account | आपका MoleculeStudio खाता |
|  | `nav_dashboard` | Dashboard | डैशबोर्ड |
|  | `nav_pricing` | Pricing | मूल्य |
|  | `nav_profile` | Profile | प्रोफ़ाइल |
| ⚑ pricing | `pricing_page_subtitle` | Browse credit packs freely. Guests can explore all plans — sign in only when you are ready to purchase. | क्रेडिट पैक आराम से देखें। अतिथि सभी योजनाएँ देख सकते हैं — खरीदने के लिए तैयार होने पर ही साइन इन करें। |
| ⚑ pricing | `pricing_page_title` | Pricing | मूल्य |
|  | `profile_admin_badge` | Admin | व्यवस्थापक |
|  | `profile_badge` | User Profile | उपयोगकर्ता प्रोफ़ाइल |
|  | `profile_cancel` | Cancel | रद्द करें |
| ⚑ billing | `profile_dashboard_hint` | View credits and billing history on your dashboard. | अपने क्रेडिट और भुगतान इतिहास डैशबोर्ड पर देखें। |
|  | `profile_dob` | Date of Birth | जन्म तिथि |
|  | `profile_edit_button` | Edit Profile | प्रोफ़ाइल संपादित करें |
|  | `profile_email_readonly` | Email cannot be changed here. | ईमेल यहाँ नहीं बदला जा सकता। |
|  | `profile_first_name` | First Name | पहला नाम |
|  | `profile_last_name` | Last Name | उपनाम |
|  | `profile_load_failed` | Profile could not be loaded. | प्रोफ़ाइल लोड नहीं हो सकी। |
|  | `profile_member_since` | Member Since | सदस्यता तिथि |
|  | `profile_retry` | Try again | फिर से प्रयास करें |
|  | `profile_save_button` | Save Changes | बदलाव सहेजें |
|  | `profile_save_failed` | Profile could not be updated. | प्रोफ़ाइल अपडेट नहीं हो सकी। |
|  | `profile_save_success` | Profile updated successfully. | प्रोफ़ाइल सफलतापूर्वक अपडेट हुई। |
|  | `profile_saving` | Saving… | सहेजा जा रहा है… |
|  | `profile_subtitle` | Manage your personal details and keep your MoleculeStudio identity up to date. | अपनी व्यक्तिगत जानकारी प्रबंधित करें और अपनी MoleculeStudio पहचान अद्यतन रखें। |
|  | `profile_title` | Your Profile | आपकी प्रोफ़ाइल |
