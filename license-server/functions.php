<?php

function license_config(): array
{
    $config = require __DIR__ . '/config.php';
    if (!isset($config['storage_file'])) {
        $config['storage_file'] = __DIR__ . '/data/licenses.json';
    }
    if (!isset($config['product_name'])) {
        $config['product_name'] = 'corp-merch-store';
    }
    return $config;
}

function license_storage_path(): string
{
    $config = license_config();
    return $config['storage_file'];
}

function ensure_license_storage(): void
{
    $file = license_storage_path();
    $dir = dirname($file);
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    if (!file_exists($file)) {
        file_put_contents($file, json_encode(['licenses' => []], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    }
}

function load_license_db(): array
{
    ensure_license_storage();
    $raw = file_get_contents(license_storage_path());
    $data = json_decode($raw ?: '', true);
    if (!is_array($data)) {
        $data = ['licenses' => []];
    }
    if (!isset($data['licenses']) || !is_array($data['licenses'])) {
        $data['licenses'] = [];
    }
    return $data;
}

function save_license_db(array $db): void
{
    ensure_license_storage();
    file_put_contents(
        license_storage_path(),
        json_encode($db, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
    );
}

function generate_license_key(): string
{
    $chunks = [];
    for ($i = 0; $i < 4; $i++) {
        $chunks[] = strtoupper(bin2hex(random_bytes(2)));
    }
    return implode('-', $chunks);
}

function duration_to_expiry(string $duration): string
{
    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    switch ($duration) {
        case '14d':
            return $now->modify('+14 days')->format(DateTimeInterface::ATOM);
        case '6m':
            return $now->modify('+6 months')->format(DateTimeInterface::ATOM);
        case '2y':
            return $now->modify('+2 years')->format(DateTimeInterface::ATOM);
        case '1y':
        default:
            return $now->modify('+1 year')->format(DateTimeInterface::ATOM);
    }
}

function duration_label(string $duration): string
{
    switch ($duration) {
        case '14d':
            return 'Триал 14 дней';
        case '6m':
            return '6 месяцев';
        case '2y':
            return '2 года';
        case '1y':
        default:
            return '1 год';
    }
}

function extend_license_expiry(array $license, string $duration): array
{
    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $base = $now;
    if (!empty($license['expires_at'])) {
        try {
            $current = new DateTimeImmutable($license['expires_at']);
            if ($current > $now) {
                $base = $current;
            }
        } catch (Throwable $e) {
            $base = $now;
        }
    }

    switch ($duration) {
        case '14d':
            $expires = $base->modify('+14 days');
            break;
        case '6m':
            $expires = $base->modify('+6 months');
            break;
        case '2y':
            $expires = $base->modify('+2 years');
            break;
        case '1y':
        default:
            $expires = $base->modify('+1 year');
            break;
    }

    $license['status'] = 'active';
    $license['expires_at'] = $expires->format(DateTimeInterface::ATOM);
    $license['updated_at'] = $now->format(DateTimeInterface::ATOM);
    return $license;
}

function find_license_index(array $db, string $licenseKey): int
{
    foreach ($db['licenses'] as $index => $license) {
        if (($license['key'] ?? '') === $licenseKey) {
            return $index;
        }
    }
    return -1;
}

function validate_license_record(array $license, array $payload): array
{
    $domain = trim((string)($payload['domain'] ?? ''));
    $siteUrl = trim((string)($payload['site_url'] ?? ''));
    $instanceId = trim((string)($payload['instance_id'] ?? ''));
    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));

    if (($license['status'] ?? 'active') !== 'active') {
        return ['valid' => false, 'reason' => 'disabled', 'message' => 'Ключ отключён'];
    }

    if (!empty($license['expires_at'])) {
        $expires = new DateTimeImmutable($license['expires_at']);
        if ($expires <= $now) {
            return ['valid' => false, 'reason' => 'expired', 'message' => 'Срок действия ключа истёк'];
        }
    }

    $boundDomain = trim((string)($license['bound_domain'] ?? ''));
    if ($boundDomain === '' && $domain !== '') {
        $license['bound_domain'] = $domain;
        $boundDomain = $domain;
    }

    if ($boundDomain !== '' && $domain !== '' && strcasecmp($boundDomain, $domain) !== 0) {
        return ['valid' => false, 'reason' => 'domain_mismatch', 'message' => 'Ключ привязан к другому домену'];
    }

    $license['last_check_at'] = $now->format(DateTimeInterface::ATOM);
    $license['last_site_url'] = $siteUrl;
    $license['instance_id'] = $instanceId ?: ($license['instance_id'] ?? '');

    return [
        'valid' => true,
        'license' => $license,
        'response' => [
            'valid' => true,
            'reason' => null,
            'message' => 'Ключ действителен',
            'plan' => duration_label((string)($license['duration'] ?? '1y')),
            'duration' => (string)($license['duration'] ?? '1y'),
            'expires_at' => $license['expires_at'] ?? null,
            'bound_domain' => $license['bound_domain'] ?? null,
            'licensed_to' => $license['customer_name'] ?? '',
        ],
    ];
}
