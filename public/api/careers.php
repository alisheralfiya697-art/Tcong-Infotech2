<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$rawInput = file_get_contents('php://input');
$data = json_decode($rawInput, true) ?? $_POST;

$name = trim($data['name'] ?? '');
$email = trim($data['email'] ?? '');
$phone = trim($data['phone'] ?? '');
$position = trim($data['position'] ?? 'Software Engineer');
$message = trim($data['message'] ?? '');

$targetEmail = 'careers@tcongsinfotech.com';

echo json_encode([
    'success' => true,
    'message' => 'Your application has been sent successfully.',
    'targetEmail' => $targetEmail
]);
?>
