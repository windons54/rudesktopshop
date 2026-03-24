import React, { useEffect, useState } from 'react';

function statusTone(licenseState) {
  if (licenseState?.loading) return { bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.2)', color: '#2563eb' };
  if (licenseState?.valid) return { bg: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.2)', color: '#15803d' };
  return { bg: 'rgba(199,22,24,0.08)', border: 'rgba(199,22,24,0.2)', color: '#b91c1c' };
}

export default function LicenseActivationCard({
  licenseState,
  isAdmin,
  currentUser,
  onActivate,
  onRefresh,
  onClear,
  onOpenSettings,
  onSignOut,
  mode = 'panel',
}) {
  const [serverUrl, setServerUrl] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [saving, setSaving] = useState(false);
  const tone = statusTone(licenseState);

  useEffect(() => {
    setServerUrl(licenseState?.config?.serverUrl || '');
  }, [licenseState?.config?.serverUrl]);

  const submit = async () => {
    setSaving(true);
    try {
      await onActivate({ serverUrl, licenseKey });
      setLicenseKey('');
    } finally {
      setSaving(false);
    }
  };

  const statusText = licenseState?.loading
    ? 'Проверяем лицензию...'
    : licenseState?.valid
    ? `Лицензия активна${licenseState?.status?.expiresAt ? ` до ${new Date(licenseState.status.expiresAt).toLocaleDateString('ru-RU')}` : ''}`
    : licenseState?.configured
    ? (licenseState?.status?.message || 'Ключ недействителен или срок лицензии истёк')
    : 'Лицензия не настроена';

  const cardStyle = mode === 'overlay'
    ? { width: 'min(680px, calc(100vw - 32px))', boxShadow: '0 24px 90px rgba(15,23,42,0.35)' }
    : {};

  return (
    <div className="settings-card" style={cardStyle}>
      <div className="settings-section-title">🔐 Активация лицензии</div>
      <div style={{ fontSize: '13px', color: 'var(--rd-gray-text)', lineHeight: 1.65, marginBottom: '14px' }}>
        Укажите адрес лицензионного сервера и ключ активации. Пока лицензия не подтверждена, функции магазина заблокированы.
      </div>

      <div style={{
        marginBottom: '14px',
        padding: '12px 14px',
        borderRadius: '12px',
        border: `1px solid ${tone.border}`,
        background: tone.bg,
        color: tone.color,
        fontSize: '13px',
        lineHeight: 1.6,
      }}>
        <div style={{ fontWeight: 700, marginBottom: '4px' }}>{statusText}</div>
        {licenseState?.status?.plan && <div>Тариф: <strong>{licenseState.status.plan}</strong></div>}
        {licenseState?.status?.boundDomain && <div>Домен: <strong>{licenseState.status.boundDomain}</strong></div>}
        {licenseState?.config?.licenseKeyMasked && <div>Ключ: <strong>{licenseState.config.licenseKeyMasked}</strong></div>}
        {licenseState?.status?.stale && (
          <div style={{ marginTop: '4px' }}>Показан последний успешный результат проверки, сервер лицензий временно недоступен.</div>
        )}
      </div>

      {isAdmin ? (
        <>
          <div style={{ display: 'grid', gap: '12px', marginBottom: '14px' }}>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '4px', color: 'var(--rd-gray-text)' }}>Адрес сервера лицензий</div>
              <input
                className="form-input"
                placeholder="https://license.example.com"
                value={serverUrl}
                onChange={e => setServerUrl(e.target.value)}
              />
            </div>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '4px', color: 'var(--rd-gray-text)' }}>Ключ активации</div>
              <input
                className="form-input"
                placeholder={licenseState?.config?.hasKey ? 'Введите новый ключ или оставьте текущий и нажмите «Проверить»' : 'XXXX-XXXX-XXXX-XXXX'}
                value={licenseKey}
                onChange={e => setLicenseKey(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={submit} disabled={saving}>
              {saving ? '⏳ Проверка...' : '✅ Сохранить и активировать'}
            </button>
            <button className="btn btn-secondary" onClick={() => onRefresh(true)}>
              🔄 Проверить текущую
            </button>
            {licenseState?.configured && (
              <button className="btn" style={{ background: 'var(--rd-red)', color: '#fff', fontWeight: 700 }} onClick={onClear}>
                🗑️ Сбросить
              </button>
            )}
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {currentUser ? (
            <>
              <div style={{ fontSize: '13px', color: 'var(--rd-gray-text)' }}>
                Обратитесь к администратору: только администратор может ввести сервер лицензий и ключ активации.
              </div>
              {onSignOut && (
                <button className="btn btn-secondary" onClick={onSignOut}>
                  Сменить пользователя
                </button>
              )}
            </>
          ) : (
            <button className="btn btn-primary" onClick={onOpenSettings}>
              🔑 Войти как администратор
            </button>
          )}
        </div>
      )}
    </div>
  );
}
