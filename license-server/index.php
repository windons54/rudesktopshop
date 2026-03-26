<?php

session_start();
require __DIR__ . '/functions.php';

$config = license_config();
$error = '';
$message = '';

if (!isset($_SESSION['license_admin'])) {
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'login') {
        if (hash_equals((string)$config['panel_password'], (string)($_POST['password'] ?? ''))) {
            $_SESSION['license_admin'] = true;
            header('Location: ./index.php');
            exit;
        }
        $error = 'Неверный пароль панели.';
    }

    ?>
    <!doctype html>
    <html lang="ru">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>License Panel</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Syne:wght@700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
      <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --bg: #f5f7fb; --surface: #ffffff; --border: #d8deea;
          --accent: #c71618; --accent-dim: rgba(199,22,24,0.12); --accent-glow: rgba(199,22,24,0.16);
          --text: #172033; --muted: #6e788f;
        }
        html, body { height: 100%; }
        body {
          font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text);
          display: flex; align-items: center; justify-content: center; min-height: 100vh;
          padding: 24px; position: relative; overflow: hidden;
        }
        body::before {
          content: ''; position: fixed; inset: 0;
          background: radial-gradient(ellipse 60% 50% at 20% 50%, rgba(199,22,24,0.05) 0%, transparent 70%);
          pointer-events: none;
        }
        .grid-bg {
          position: fixed; inset: 0;
          background-image: linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px);
          background-size: 48px 48px; opacity: 0.3; pointer-events: none;
        }
        .login-card {
          position: relative; width: 100%; max-width: 400px; background: var(--surface);
          border: 1px solid var(--border); border-radius: 20px; padding: 40px 36px;
          box-shadow: 0 24px 60px rgba(23,32,51,0.08), 0 0 0 1px rgba(255,255,255,0.6) inset;
          animation: slideUp 0.4s cubic-bezier(0.22, 1, 0.36, 1);
        }
        @keyframes slideUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        .login-icon {
          width: 48px; height: 48px; background: var(--accent-dim); border: 1px solid var(--accent-glow);
          border-radius: 14px; display: flex; align-items: center; justify-content: center; margin-bottom: 24px;
        }
        .login-icon svg { width: 22px; height: 22px; color: var(--accent); }
        h1 { font-family: 'Syne', sans-serif; font-size: 26px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 6px; }
        .subtitle { color: var(--muted); font-size: 14px; line-height: 1.6; margin-bottom: 28px; }
        .form-group { margin-bottom: 16px; }
        .form-label { display: block; font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }
        input[type="password"] {
          width: 100%; background: var(--bg); border: 1px solid #c8d1e0; border-radius: 10px;
          padding: 12px 14px; color: var(--text); font-family: 'Inter', sans-serif; font-size: 14px;
          transition: border-color 0.2s, box-shadow 0.2s; outline: none;
        }
        input[type="password"]:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-dim); }
        input::placeholder { color: var(--muted); }
        .btn-primary {
          display: flex; align-items: center; justify-content: center; gap: 6px;
          width: 100%; border: none; border-radius: 10px; padding: 12px 20px;
          font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 600; cursor: pointer;
          background: var(--accent); color: #fff; box-shadow: 0 4px 20px var(--accent-glow);
          transition: all 0.18s; margin-top: 4px;
        }
        .btn-primary:hover { background: #e01a1c; transform: translateY(-1px); }
        .error-box {
          background: #fdeeee; border: 1px solid #f2c3c3; color: #b42318;
          padding: 11px 14px; border-radius: 10px; margin-bottom: 16px; font-size: 13px;
          display: flex; align-items: center; gap: 8px;
        }
      </style>
    </head>
    <body>
      <div class="grid-bg"></div>
      <div class="login-card">
        <div class="login-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <h1>License Panel</h1>
        <p class="subtitle">Введите пароль администратора для доступа к панели управления лицензиями.</p>
        <?php if ($error): ?>
        <div class="error-box">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?>
        </div>
        <?php endif; ?>
        <form method="post">
          <input type="hidden" name="action" value="login">
          <div class="form-group">
            <label class="form-label">Пароль</label>
            <input type="password" name="password" placeholder="••••••••••••" required autofocus>
          </div>
          <button type="submit" class="btn-primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
            Войти
          </button>
        </form>
      </div>
    </body>
    </html>
    <?php
    exit;
}

if (($_GET['action'] ?? '') === 'logout') {
    session_destroy();
    header('Location: ./index.php');
    exit;
}

$db = load_license_db();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';

    if ($action === 'generate') {
        $duration = $_POST['duration'] ?? '1y';
        $customerName = trim((string)($_POST['customer_name'] ?? ''));
        $customerEmail = trim((string)($_POST['customer_email'] ?? ''));
        $customerInn = trim((string)($_POST['customer_inn'] ?? ''));
        $customerPhone = trim((string)($_POST['customer_phone'] ?? ''));
        $notes = trim((string)($_POST['notes'] ?? ''));
        $key = generate_license_key();

        $db['licenses'][] = [
            'key' => $key,
            'status' => 'active',
            'duration' => $duration,
            'expires_at' => duration_to_expiry($duration),
            'customer_name' => $customerName,
            'customer_email' => $customerEmail,
            'customer_inn' => $customerInn,
            'customer_phone' => $customerPhone,
            'notes' => $notes,
            'bound_domain' => '',
            'instance_id' => '',
            'created_at' => gmdate(DateTimeInterface::ATOM),
            'updated_at' => gmdate(DateTimeInterface::ATOM),
            'last_check_at' => null,
            'last_site_url' => null,
        ];

        save_license_db($db);
        $message = "Ключ создан: {$key}";
    }

    if ($action === 'toggle') {
        $key = $_POST['key'] ?? '';
        $index = find_license_index($db, $key);
        if ($index >= 0) {
            $db['licenses'][$index]['status'] = ($db['licenses'][$index]['status'] ?? 'active') === 'active' ? 'disabled' : 'active';
            $db['licenses'][$index]['updated_at'] = gmdate(DateTimeInterface::ATOM);
            save_license_db($db);
            $message = 'Статус ключа обновлён.';
        }
    }

    if ($action === 'extend') {
        $key = $_POST['key'] ?? '';
        $duration = $_POST['extend_duration'] ?? '14d';
        $index = find_license_index($db, $key);
        if ($index >= 0) {
            $db['licenses'][$index] = extend_license_expiry($db['licenses'][$index], $duration);
            save_license_db($db);
            $message = 'Срок действия ключа продлён.';
        }
    }
}

$query = trim((string)($_GET['q'] ?? ''));
$durationFilter = trim((string)($_GET['duration'] ?? ''));
$statusFilter = trim((string)($_GET['status'] ?? ''));
$dateFrom = trim((string)($_GET['date_from'] ?? ''));
$dateTo = trim((string)($_GET['date_to'] ?? ''));

$licenses = array_values(array_filter(array_reverse($db['licenses']), function (array $license) use ($query, $durationFilter, $statusFilter, $dateFrom, $dateTo): bool {
    if ($query !== '') {
        $haystack = mb_strtolower(implode(' ', [
            (string)($license['customer_name'] ?? ''),
            (string)($license['customer_email'] ?? ''),
            (string)($license['customer_inn'] ?? ''),
            (string)($license['customer_phone'] ?? ''),
            (string)($license['notes'] ?? ''),
            (string)($license['key'] ?? ''),
            (string)($license['bound_domain'] ?? ''),
        ]));
        if (mb_strpos($haystack, mb_strtolower($query)) === false) {
            return false;
        }
    }
    if ($durationFilter !== '' && ($license['duration'] ?? '') !== $durationFilter) { return false; }
    if ($statusFilter !== '' && ($license['status'] ?? 'active') !== $statusFilter) { return false; }
    if ($dateFrom !== '' || $dateTo !== '') {
        $createdAt = substr((string)($license['created_at'] ?? ''), 0, 10);
        if ($dateFrom !== '' && $createdAt < $dateFrom) return false;
        if ($dateTo !== '' && $createdAt > $dateTo) return false;
    }
    return true;
}));

$allLicenses = $db['licenses'];
$totalCount = count($allLicenses);
$activeCount = count(array_filter($allLicenses, fn($l) => ($l['status'] ?? 'active') === 'active'));
$disabledCount = $totalCount - $activeCount;
?>
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>License Panel</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Syne:wght@700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --bg: #f5f7fb; --surface: #ffffff; --surface2: #f1f4fa;
          --border: #d8deea; --border2: #c8d1e0;
          --accent: #c71618; --accent-dim: rgba(199,22,24,0.1); --accent-glow: rgba(199,22,24,0.16);
          --text: #172033; --text2: #59647b; --muted: #7a8499;
          --success-bg: #e8f8f0; --success-border: #b9e6cf; --success-text: #19734c;
          --danger-bg: #fdeeee; --danger-border: #f2c3c3; --danger-text: #b42318;
          --radius: 12px;
        }
    body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; line-height: 1.5; }
    .app { display: grid; grid-template-columns: 280px 1fr; min-height: 100vh; }
    .sidebar { background: var(--surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
    .sidebar-header { padding: 28px 24px 24px; border-bottom: 1px solid var(--border); }
    .logo { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
    .logo-icon { width: 36px; height: 36px; background: var(--accent-dim); border: 1px solid var(--accent-glow); border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .logo-icon svg { width: 18px; height: 18px; color: var(--accent); }
    .logo-name { font-family: 'Syne', sans-serif; font-size: 18px; font-weight: 800; letter-spacing: -0.3px; }
    .sidebar-meta { font-size: 11px; color: var(--muted); letter-spacing: 0.04em; text-transform: uppercase; margin-top: 2px; }
    .sidebar-section { padding: 20px 16px; flex: 1; }
    .sidebar-label { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); padding: 0 8px; margin-bottom: 12px; }
    .form-group { margin-bottom: 14px; }
    .form-label { display: block; font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text2); margin-bottom: 6px; }
    input[type="text"], input[type="email"], input[type="date"], textarea, select {
      width: 100%; background: var(--bg); border: 1px solid var(--border2); border-radius: 8px;
      padding: 9px 12px; color: var(--text); font-family: 'Inter', sans-serif; font-size: 13px;
      transition: border-color 0.18s, box-shadow 0.18s; outline: none; -webkit-appearance: none;
    }
    input:focus, textarea:focus, select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-dim); }
    input::placeholder, textarea::placeholder { color: var(--muted); }
    select {
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%234a5070' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
      background-repeat: no-repeat; background-position: right 12px center; padding-right: 32px; cursor: pointer;
    }
    select option { background: #ffffff; color: var(--text); }
    textarea { min-height: 72px; resize: vertical; line-height: 1.5; }
    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      border: none; border-radius: 8px; padding: 9px 16px; font-family: 'Inter', sans-serif;
      font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.18s;
      text-decoration: none; white-space: nowrap;
    }
    .btn-primary { background: var(--accent); color: #fff; box-shadow: 0 4px 16px var(--accent-glow); }
    .btn-primary:hover { background: #e01a1c; transform: translateY(-1px); }
    .btn-ghost { background: var(--surface2); color: var(--text2); border: 1px solid var(--border2); }
    .btn-ghost:hover { background: var(--border2); color: var(--text); }
    .btn-danger { background: var(--danger-bg); color: var(--danger-text); border: 1px solid var(--danger-border); }
    .btn-danger:hover { background: rgba(199,22,24,0.18); }
    .btn-success { background: var(--success-bg); color: var(--success-text); border: 1px solid var(--success-border); }
    .btn-success:hover { background: rgba(14,159,110,0.18); }
    .btn-full { width: 100%; }
    .btn-sm { padding: 6px 11px; font-size: 12px; border-radius: 7px; }
    .sidebar-footer { padding: 16px; border-top: 1px solid var(--border); }
    .main { display: flex; flex-direction: column; min-height: 100vh; overflow: hidden; }
    .topbar { background: var(--surface); border-bottom: 1px solid var(--border); padding: 16px 28px; display: flex; align-items: center; justify-content: space-between; gap: 16px; position: sticky; top: 0; z-index: 10; }
    .topbar-title { font-family: 'Syne', sans-serif; font-size: 20px; font-weight: 800; letter-spacing: -0.3px; }
    .topbar-meta { font-size: 13px; color: var(--text2); }
    .alert { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-radius: var(--radius); font-size: 13px; font-weight: 500; margin: 20px 28px 0; animation: alertIn 0.3s ease; }
    @keyframes alertIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
    .alert-success { background: var(--success-bg); border: 1px solid var(--success-border); color: var(--success-text); }
    .alert code { font-family: 'IBM Plex Mono', monospace; font-size: 13px; background: rgba(23,32,51,0.08); padding: 2px 7px; border-radius: 5px; }
    .stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding: 20px 28px 0; }
    .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 18px; }
    .stat-label { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
    .stat-value { font-family: 'Syne', sans-serif; font-size: 28px; font-weight: 800; letter-spacing: -1px; line-height: 1; }
    .stat-value.green { color: var(--success-text); }
    .stat-value.red { color: var(--accent); }
    .filters-bar { padding: 20px 28px 0; }
    .filters-form { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr 1fr auto; gap: 10px; align-items: end; }
    .filter-group { display: flex; flex-direction: column; gap: 5px; }
    .table-wrap { padding: 20px 28px 40px; flex: 1; }
    .table-card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; overflow: hidden; }
    .table-head { padding: 14px 20px; border-bottom: 1px solid var(--border); }
    .table-count { font-size: 13px; color: var(--text2); }
    .table-count strong { color: var(--text); font-weight: 600; }
    table { width: 100%; border-collapse: collapse; }
    thead tr { background: var(--surface2); }
    th { padding: 11px 16px; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; }
    td { padding: 13px 16px; font-size: 13px; vertical-align: middle; border-bottom: 1px solid var(--border); }
    tr:last-child td { border-bottom: none; }
    tbody tr { transition: background 0.15s; }
    tbody tr:hover { background: #f7f9fd; }
    .key-mono { font-family: 'IBM Plex Mono', monospace; font-size: 13px; letter-spacing: 0.04em; }
    .cell-sub { font-size: 11px; color: var(--muted); margin-top: 3px; }
    .badge { display: inline-flex; align-items: center; gap: 5px; border-radius: 999px; padding: 3px 10px; font-size: 11px; font-weight: 700; }
    .badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; }
    .badge-active { background: var(--success-bg); color: var(--success-text); border: 1px solid var(--success-border); }
    .badge-active::before { background: var(--success-text); }
    .badge-disabled { background: var(--danger-bg); color: var(--danger-text); border: 1px solid var(--danger-border); }
    .badge-disabled::before { background: var(--danger-text); }
    .actions-cell { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .actions-cell form { margin: 0; display: contents; }
    .extend-group { display: flex; align-items: center; gap: 6px; }
    .extend-group select { width: auto; padding: 6px 28px 6px 10px; font-size: 12px; }
    .empty-state { text-align: center; padding: 56px 24px; color: var(--muted); }
    .empty-state svg { width: 40px; height: 40px; margin: 0 auto 16px; opacity: 0.3; }
    .empty-state p { font-size: 14px; line-height: 1.7; }
    @media (max-width: 1024px) {
      .app { grid-template-columns: 1fr; }
      .sidebar { position: static; height: auto; }
      .filters-form { grid-template-columns: 1fr 1fr 1fr; }
      .stats-row { grid-template-columns: repeat(3,1fr); }
    }
    @media (max-width: 640px) {
      .filters-form { grid-template-columns: 1fr; }
      .stats-row { grid-template-columns: 1fr; }
      .table-wrap, .filters-bar, .stats-row { padding-left: 16px; padding-right: 16px; }
      .topbar { padding: 14px 16px; }
    }
  </style>
</head>
<body>
<div class="app">

  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="logo">
        <div class="logo-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
        <span class="logo-name">LicensePanel</span>
      </div>
      <div class="sidebar-meta">Панель управления ключами</div>
    </div>

    <div class="sidebar-section">
      <div class="sidebar-label">Новый ключ</div>
      <form method="post">
        <input type="hidden" name="action" value="generate">
        <div class="form-group">
          <label class="form-label">Срок действия</label>
          <select name="duration">
            <option value="14d">Триал — 14 дней</option>
            <option value="6m">6 месяцев</option>
            <option value="1y" selected>1 год</option>
            <option value="2y">2 года</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Клиент / Проект</label>
          <input type="text" name="customer_name" placeholder="Название компании">
        </div>
        <div class="form-group">
          <label class="form-label">Email</label>
          <input type="email" name="customer_email" placeholder="mail@example.com">
        </div>
        <div class="form-group">
          <label class="form-label">ИНН</label>
          <input type="text" name="customer_inn" placeholder="Например, 5401234567">
        </div>
        <div class="form-group">
          <label class="form-label">Телефон</label>
          <input type="text" name="customer_phone" placeholder="+7 (999) 123-45-67">
        </div>
        <div class="form-group">
          <label class="form-label">Заметка</label>
          <textarea name="notes" placeholder="Комментарий для менеджера"></textarea>
        </div>
        <button type="submit" class="btn btn-primary btn-full">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Сгенерировать ключ
        </button>
      </form>
    </div>

    <div class="sidebar-footer">
      <a href="?action=logout" class="btn btn-ghost btn-full">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        Выйти
      </a>
    </div>
  </aside>

  <div class="main">
    <div class="topbar">
      <div>
        <div class="topbar-title">Выданные ключи</div>
        <div class="topbar-meta">Управление лицензиями и активациями</div>
      </div>
      <span class="topbar-meta"><?= date('d.m.Y') ?></span>
    </div>

    <?php if ($message): ?>
    <div class="alert alert-success">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      <?php
        $msg = htmlspecialchars($message, ENT_QUOTES, 'UTF-8');
        $msg = preg_replace('/([A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4})/', '<code>$1</code>', $msg);
        echo $msg;
      ?>
    </div>
    <?php endif; ?>

    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-label">Всего ключей</div>
        <div class="stat-value"><?= $totalCount ?></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Активные</div>
        <div class="stat-value green"><?= $activeCount ?></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Отключённые</div>
        <div class="stat-value red"><?= $disabledCount ?></div>
      </div>
    </div>

    <div class="filters-bar">
      <form method="get" class="filters-form">
        <div class="filter-group">
          <label class="form-label">Поиск</label>
          <input type="text" name="q" value="<?= htmlspecialchars($query, ENT_QUOTES, 'UTF-8') ?>" placeholder="Компания, email, ИНН, телефон, домен, ключ…">
        </div>
        <div class="filter-group">
          <label class="form-label">Срок</label>
          <select name="duration">
            <option value="">Все сроки</option>
            <option value="14d" <?= $durationFilter==='14d'?'selected':'' ?>>Триал 14 дней</option>
            <option value="6m"  <?= $durationFilter==='6m' ?'selected':'' ?>>6 месяцев</option>
            <option value="1y"  <?= $durationFilter==='1y' ?'selected':'' ?>>1 год</option>
            <option value="2y"  <?= $durationFilter==='2y' ?'selected':'' ?>>2 года</option>
          </select>
        </div>
        <div class="filter-group">
          <label class="form-label">Статус</label>
          <select name="status">
            <option value="">Все</option>
            <option value="active"   <?= $statusFilter==='active'   ?'selected':'' ?>>Активен</option>
            <option value="disabled" <?= $statusFilter==='disabled' ?'selected':'' ?>>Отключён</option>
          </select>
        </div>
        <div class="filter-group">
          <label class="form-label">Дата от</label>
          <input type="date" name="date_from" value="<?= htmlspecialchars($dateFrom, ENT_QUOTES, 'UTF-8') ?>">
        </div>
        <div class="filter-group">
          <label class="form-label">Дата до</label>
          <input type="date" name="date_to" value="<?= htmlspecialchars($dateTo, ENT_QUOTES, 'UTF-8') ?>">
        </div>
        <div class="filter-group">
          <label class="form-label">&nbsp;</label>
          <button type="submit" class="btn btn-ghost">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Найти
          </button>
        </div>
      </form>
    </div>

    <div class="table-wrap">
      <div class="table-card">
        <div class="table-head">
          <div class="table-count">Показано <strong><?= count($licenses) ?></strong> из <strong><?= $totalCount ?></strong></div>
        </div>

        <?php if ($licenses): ?>
        <div style="overflow-x:auto;">
          <table>
            <thead>
              <tr>
                <th>Ключ активации</th>
                <th>Срок / Истекает</th>
                <th>Клиент</th>
                <th>Домен</th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              <?php foreach ($licenses as $license):
                $isActive = ($license['status'] ?? 'active') === 'active'; ?>
              <tr>
                <td><span class="key-mono"><?= htmlspecialchars($license['key'] ?? '', ENT_QUOTES, 'UTF-8') ?></span></td>
                <td>
                  <?= htmlspecialchars(duration_label((string)($license['duration'] ?? '1y')), ENT_QUOTES, 'UTF-8') ?>
                  <div class="cell-sub"><?= htmlspecialchars(substr((string)($license['expires_at'] ?? ''), 0, 10), ENT_QUOTES, 'UTF-8') ?></div>
                </td>
                <td>
                  <?= htmlspecialchars($license['customer_name'] ?: '—', ENT_QUOTES, 'UTF-8') ?>
                  <?php if (!empty($license['customer_email'])): ?>
                  <div class="cell-sub"><?= htmlspecialchars($license['customer_email'], ENT_QUOTES, 'UTF-8') ?></div>
                  <?php endif; ?>
                  <?php if (!empty($license['customer_inn'])): ?>
                  <div class="cell-sub">ИНН: <?= htmlspecialchars($license['customer_inn'], ENT_QUOTES, 'UTF-8') ?></div>
                  <?php endif; ?>
                  <?php if (!empty($license['customer_phone'])): ?>
                  <div class="cell-sub">Тел.: <?= htmlspecialchars($license['customer_phone'], ENT_QUOTES, 'UTF-8') ?></div>
                  <?php endif; ?>
                </td>
                <td>
                  <?= htmlspecialchars($license['bound_domain'] ?: '—', ENT_QUOTES, 'UTF-8') ?>
                  <?php if (!empty($license['last_site_url'])): ?>
                  <div class="cell-sub"><?= htmlspecialchars($license['last_site_url'], ENT_QUOTES, 'UTF-8') ?></div>
                  <?php endif; ?>
                </td>
                <td>
                  <span class="badge <?= $isActive ? 'badge-active' : 'badge-disabled' ?>">
                    <?= $isActive ? 'Активен' : 'Отключён' ?>
                  </span>
                </td>
                <td>
                  <div class="actions-cell">
                    <form method="post">
                      <input type="hidden" name="action" value="toggle">
                      <input type="hidden" name="key" value="<?= htmlspecialchars($license['key'] ?? '', ENT_QUOTES, 'UTF-8') ?>">
                      <button type="submit" class="btn btn-sm <?= $isActive ? 'btn-danger' : 'btn-success' ?>">
                        <?php if ($isActive): ?>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>Отключить
                        <?php else: ?>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>Включить
                        <?php endif; ?>
                      </button>
                    </form>
                    <form method="post">
                      <input type="hidden" name="action" value="extend">
                      <input type="hidden" name="key" value="<?= htmlspecialchars($license['key'] ?? '', ENT_QUOTES, 'UTF-8') ?>">
                      <div class="extend-group">
                        <select name="extend_duration">
                          <option value="14d">+14 дней</option>
                          <option value="6m">+6 мес.</option>
                          <option value="1y">+1 год</option>
                          <option value="2y">+2 года</option>
                        </select>
                        <button type="submit" class="btn btn-sm btn-ghost">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>Продлить
                        </button>
                      </div>
                    </form>
                  </div>
                </td>
              </tr>
              <?php endforeach; ?>
            </tbody>
          </table>
        </div>
        <?php else: ?>
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 9h6M9 12h6M9 15h4"/>
          </svg>
          <p>Ключей не найдено.<br>Попробуйте изменить фильтры или создайте новый ключ.</p>
        </div>
        <?php endif; ?>
      </div>
    </div>
  </div>
</div>
</body>
</html>
