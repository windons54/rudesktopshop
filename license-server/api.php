<?php

require __DIR__ . '/functions.php';

header('Content-Type: application/json; charset=utf-8');

$config = license_config();
$action = $_GET['action'] ?? 'validate';
$body = json_decode(file_get_contents('php://input') ?: '{}', true);
if (!is_array($body)) {
    $body = [];
}

if ($action !== 'validate') {
    http_response_code(400);
    echo json_encode(['valid' => false, 'reason' => 'unknown_action', 'message' => 'Unknown action']);
    exit;
}

if (($body['product'] ?? '') && $body['product'] !== $config['product_name']) {
    http_response_code(400);
    echo json_encode(['valid' => false, 'reason' => 'wrong_product', 'message' => 'Неверный продукт']);
    exit;
}

$licenseKey = trim((string)($body['license_key'] ?? ''));
if ($licenseKey === '') {
    http_response_code(400);
    echo json_encode(['valid' => false, 'reason' => 'missing_key', 'message' => 'Ключ не передан']);
    exit;
}

$db = load_license_db();
$index = find_license_index($db, $licenseKey);
if ($index < 0) {
    echo json_encode(['valid' => false, 'reason' => 'not_found', 'message' => 'Ключ не найден']);
    exit;
}

$result = validate_license_record($db['licenses'][$index], $body);
if (!($result['valid'] ?? false)) {
    echo json_encode($result);
    exit;
}

$db['licenses'][$index] = $result['license'];
save_license_db($db);
echo json_encode($result['response'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
