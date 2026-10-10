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
$message = trim($data['message'] ?? '');

if (empty($name) || empty($email) || empty($message)) {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'error' => 'Validation failed.',
        'details' => [
            'name' => empty($name) ? 'Please provide your name.' : null,
            'email' => empty($email) ? 'Please provide a valid email.' : null,
            'message' => empty($message) ? 'Please provide a message.' : null,
        ]
    ]);
    exit;
}

$recipient = 'info@tcongsinfotech.com';
$subject = 'New Website Contact — TCONG INFOTECH: ' . $name;
$body = "Name: $name\nEmail: $email\nPhone: $phone\nMessage: $message\n";
@mail($recipient, $subject, $body, "From: noreply@tcongsinfotech.com\r\nReply-To: $email");

echo json_encode([
    'success' => true,
    'message' => 'Your details have been sent successfully.',
    'targetEmail' => $recipient
]);
?>
