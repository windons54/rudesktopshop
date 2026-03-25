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
      <title>Панель лицензий</title>
      <style>
        body { font-family: Arial, sans-serif; background: #f5f7fb; margin: 0; }
        .wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
        .card { width: 100%; max-width: 420px; background: #fff; border-radius: 16px; padding: 28px; box-shadow: 0 20px 60px rgba(15, 23, 42, 0.12); }
        h1 { margin: 0 0 12px; font-size: 24px; }
        p { color: #475569; line-height: 1.6; }
        input { width: 100%; box-sizing: border-box; padding: 12px 14px; border: 1px solid #cbd5e1; border-radius: 10px; margin-top: 8px; margin-bottom: 16px; }
        button { width: 100%; border: 0; border-radius: 10px; padding: 12px 16px; background: #c71618; color: #fff; font-weight: 700; cursor: pointer; }
        .error { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; padding: 10px 12px; border-radius: 10px; margin-bottom: 14px; }
      </style>
    </head>
    <body>
      <div class="wrap">
        <form class="card" method="post">
          <h1>Панель лицензий</h1>
          <p>Введите пароль администратора, чтобы создавать и проверять ключи активации.</p>
          <?php if ($error): ?><div class="error"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></div><?php endif; ?>
          <input type="hidden" name="action" value="login">
          <label>Пароль</label>
          <input type="password" name="password" placeholder="Введите пароль" required>
          <button type="submit">Войти</button>
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
        $notes = trim((string)($_POST['notes'] ?? ''));
        $key = generate_license_key();

        $db['licenses'][] = [
            'key' => $key,
            'status' => 'active',
            'duration' => $duration,
            'expires_at' => duration_to_expiry($duration),
            'customer_name' => $customerName,
            'customer_email' => $customerEmail,
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
            (string)($license['notes'] ?? ''),
            (string)($license['key'] ?? ''),
            (string)($license['bound_domain'] ?? ''),
        ]));
        if (mb_strpos($haystack, mb_strtolower($query)) === false) {
            return false;
        }
    }

    if ($durationFilter !== '' && ($license['duration'] ?? '') !== $durationFilter) {
        return false;
    }

    if ($statusFilter !== '' && ($license['status'] ?? 'active') !== $statusFilter) {
        return false;
    }

    if ($dateFrom !== '' || $dateTo !== '') {
        $createdAt = substr((string)($license['created_at'] ?? ''), 0, 10);
        if ($dateFrom !== '' && $createdAt < $dateFrom) return false;
        if ($dateTo !== '' && $createdAt > $dateTo) return false;
    }

    return true;
}));
?>
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Панель лицензий</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; }
    .page { max-width: 1180px; margin: 0 auto; padding: 28px 20px 40px; }
    .top { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 22px; }
    .grid { display: grid; grid-template-columns: 360px 1fr; gap: 18px; align-items: start; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px; box-shadow: 0 10px 30px rgba(15,23,42,0.06); }
    h1, h2 { margin: 0 0 10px; }
    p { color: #475569; line-height: 1.6; }
    label { display: block; font-size: 13px; font-weight: 700; margin-top: 12px; margin-bottom: 4px; }
    input, textarea, select { width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 10px; padding: 11px 12px; font: inherit; }
    textarea { min-height: 90px; resize: vertical; }
    button, .button { border: 0; border-radius: 10px; padding: 11px 14px; font-weight: 700; cursor: pointer; background: #c71618; color: #fff; text-decoration: none; display: inline-block; }
    .muted { background: #e2e8f0; color: #0f172a; }
    .success { background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; padding: 10px 12px; border-radius: 10px; margin-bottom: 12px; }
    .table { width: 100%; border-collapse: collapse; font-size: 14px; }
    .table th, .table td { border-bottom: 1px solid #e2e8f0; padding: 10px 8px; vertical-align: top; text-align: left; }
    .badge { display: inline-block; border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 700; }
    .badge.active { background: #dcfce7; color: #166534; }
    .badge.disabled { background: #fee2e2; color: #b91c1c; }
    .mono { font-family: monospace; font-size: 13px; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .filters { display: grid; grid-template-columns: 1.4fr 1fr 1fr 1fr 1fr auto; gap: 10px; margin-bottom: 16px; align-items: end; }
    .filters .field { display: flex; flex-direction: column; gap: 4px; }
    .filters label { margin: 0; }
    .actions form { margin: 0; }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } .top { flex-direction: column; align-items: flex-start; } }
    @media (max-width: 1100px) { .filters { grid-template-columns: 1fr 1fr; } }
  </style>
</head>
<body>
  <div class="page">
    <div class="top">
      <div>
        <h1>Панель лицензий</h1>
        <p>Создание и проверка ключей активации для интернет-магазина.</p>
      </div>
      <a class="button muted" href="?action=logout">Выйти</a>
    </div>

    <?php if ($message): ?><div class="success"><?= htmlspecialchars($message, ENT_QUOTES, 'UTF-8') ?></div><?php endif; ?>

    <div class="grid">
      <div class="card">
        <h2>Создать ключ</h2>
        <form method="post">
          <input type="hidden" name="action" value="generate">
          <label>Срок действия</label>
          <select name="duration">
            <option value="14d">Триал 14 дней</option>
            <option value="6m">6 месяцев</option>
            <option value="1y">1 год</option>
            <option value="2y">2 года</option>
          </select>

          <label>Клиент</label>
          <input type="text" name="customer_name" placeholder="Название клиента или проекта">

          <label>Email</label>
          <input type="email" name="customer_email" placeholder="mail@example.com">

          <label>Заметки</label>
          <textarea name="notes" placeholder="Комментарий для менеджера"></textarea>

          <div style="margin-top:16px;">
            <button type="submit">Сгенерировать ключ</button>
          </div>
        </form>
      </div>

      <div class="card">
        <h2>Выданные ключи</h2>
        <form method="get" class="filters">
          <div class="field">
            <label>Поиск по компании</label>
            <input type="text" name="q" value="<?= htmlspecialchars($query, ENT_QUOTES, 'UTF-8') ?>" placeholder="Название компании, email, домен, ключ">
          </div>
          <div class="field">
            <label>Срок</label>
            <select name="duration">
              <option value="">Все</option>
              <option value="14d" <?= $durationFilter === '14d' ? 'selected' : '' ?>>Триал 14 дней</option>
              <option value="6m" <?= $durationFilter === '6m' ? 'selected' : '' ?>>6 месяцев</option>
              <option value="1y" <?= $durationFilter === '1y' ? 'selected' : '' ?>>1 год</option>
              <option value="2y" <?= $durationFilter === '2y' ? 'selected' : '' ?>>2 года</option>
            </select>
          </div>
          <div class="field">
            <label>Статус</label>
            <select name="status">
              <option value="">Все</option>
              <option value="active" <?= $statusFilter === 'active' ? 'selected' : '' ?>>Активен</option>
              <option value="disabled" <?= $statusFilter === 'disabled' ? 'selected' : '' ?>>Отключён</option>
            </select>
          </div>
          <div class="field">
            <label>Дата от</label>
            <input type="date" name="date_from" value="<?= htmlspecialchars($dateFrom, ENT_QUOTES, 'UTF-8') ?>">
          </div>
          <div class="field">
            <label>Дата до</label>
            <input type="date" name="date_to" value="<?= htmlspecialchars($dateTo, ENT_QUOTES, 'UTF-8') ?>">
          </div>
          <div class="field">
            <button type="submit">Фильтр</button>
          </div>
        </form>
        <table class="table">
          <thead>
            <tr>
              <th>Ключ</th>
              <th>Срок</th>
              <th>Клиент</th>
              <th>Домен</th>
              <th>Статус</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            <?php foreach ($licenses as $license): ?>
              <tr>
                <td class="mono"><?= htmlspecialchars($license['key'] ?? '', ENT_QUOTES, 'UTF-8') ?></td>
                <td>
                  <?= htmlspecialchars(duration_label((string)($license['duration'] ?? '1y')), ENT_QUOTES, 'UTF-8') ?><br>
                  <span style="color:#64748b;font-size:12px;"><?= htmlspecialchars(substr((string)($license['expires_at'] ?? ''), 0, 10), ENT_QUOTES, 'UTF-8') ?></span>
                </td>
                <td>
                  <?= htmlspecialchars($license['customer_name'] ?: '—', ENT_QUOTES, 'UTF-8') ?><br>
                  <span style="color:#64748b;font-size:12px;"><?= htmlspecialchars($license['customer_email'] ?: '', ENT_QUOTES, 'UTF-8') ?></span>
                </td>
                <td>
                  <?= htmlspecialchars($license['bound_domain'] ?: 'не привязан', ENT_QUOTES, 'UTF-8') ?><br>
                  <span style="color:#64748b;font-size:12px;"><?= htmlspecialchars($license['last_site_url'] ?: '', ENT_QUOTES, 'UTF-8') ?></span>
                </td>
                <td>
                  <span class="badge <?= ($license['status'] ?? 'active') === 'active' ? 'active' : 'disabled' ?>">
                    <?= ($license['status'] ?? 'active') === 'active' ? 'Активен' : 'Отключён' ?>
                  </span>
                </td>
                <td>
                  <form method="post" class="actions">
                    <input type="hidden" name="action" value="toggle">
                    <input type="hidden" name="key" value="<?= htmlspecialchars($license['key'] ?? '', ENT_QUOTES, 'UTF-8') ?>">
                    <button type="submit" class="muted"><?= ($license['status'] ?? 'active') === 'active' ? 'Отключить' : 'Включить' ?></button>
                  </form>
                  <form method="post" class="actions">
                    <input type="hidden" name="action" value="extend">
                    <input type="hidden" name="key" value="<?= htmlspecialchars($license['key'] ?? '', ENT_QUOTES, 'UTF-8') ?>">
                    <select name="extend_duration">
                      <option value="14d">+14 дней</option>
                      <option value="6m">+6 месяцев</option>
                      <option value="1y">+1 год</option>
                      <option value="2y">+2 года</option>
                    </select>
                    <button type="submit">Продлить</button>
                  </form>
                </td>
              </tr>
            <?php endforeach; ?>
            <?php if (!$licenses): ?>
              <tr><td colspan="6" style="color:#64748b;">Ключей пока нет.</td></tr>
            <?php endif; ?>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</body>
</html>
