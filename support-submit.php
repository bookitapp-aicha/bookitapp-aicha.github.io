<?php
/**
 * Bookit Support Contact Form Handler (/support & /support-ar)
 *
 * Accepts POST submissions from support.html and support-ar.html,
 * validates input, applies IP-based rate limiting and honeypot spam checks,
 * logs submissions locally as a durable backup, and dispatches a transactional
 * email to Bookit Support via the Brevo v3 SMTP API.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

// Allow same-origin and bookit-app.com subdomains
$allowedOrigins = [
    'https://bookit-app.com',
    'https://www.bookit-app.com',
];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowedOrigins, true)) {
    header("Access-Control-Allow-Origin: {$origin}");
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Accept');
}

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    echo json_encode([
        'ok' => false,
        'error' => 'Method not allowed. Use POST.',
    ]);
    exit;
}

// Parse JSON body or standard form-urlencoded / multipart POST
$rawBody = (string) file_get_contents('php://input');
$contentType = strtolower($_SERVER['CONTENT_TYPE'] ?? '');
$input = [];

if (strpos($contentType, 'application/json') !== false && $rawBody !== '') {
    $decoded = json_decode($rawBody, true);
    if (is_array($decoded)) {
        $input = $decoded;
    }
} else {
    $input = $_POST;
}

/**
 * Helper to fetch and sanitize a string field
 */
function get_field(array $data, array $keys, int $maxLength = 256): string
{
    foreach ($keys as $key) {
        if (isset($data[$key]) && is_string($data[$key])) {
            $val = trim($data[$key]);
            // Strip control characters except newlines/tabs for multi-line fields
            $val = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $val) ?? '';
            return mb_substr($val, 0, $maxLength, 'UTF-8');
        }
    }
    return '';
}

// 1. Honeypot check (bots filling hidden field)
$honeypot = get_field($input, ['website_url', 'company_website'], 256);
if ($honeypot !== '') {
    // Pretend success so bots do not retry
    http_response_code(200);
    echo json_encode(['ok' => true]);
    exit;
}

// 2. Determine client IP (respecting CloudFront X-Forwarded-For)
$clientIp = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
    $parts = explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR']);
    $candidate = trim($parts[0]);
    if (filter_var($candidate, FILTER_VALIDATE_IP)) {
        $clientIp = $candidate;
    }
}

// 3. Simple file-based rate limiting (max 8 submissions per 10 minutes per IP)
$rateLimitDir = '/tmp/bookit_support_ratelimit';
if (!is_dir($rateLimitDir)) {
    @mkdir($rateLimitDir, 0700, true);
}
$ipHash = hash('sha256', $clientIp);
$rateFile = $rateLimitDir . '/' . $ipHash . '.json';
$now = time();
$windowSeconds = 600;
$maxRequests = 8;

$timestamps = [];
if (is_file($rateFile)) {
    $existing = json_decode((string) @file_get_contents($rateFile), true);
    if (is_array($existing)) {
        foreach ($existing as $ts) {
            if (is_int($ts) && ($now - $ts) < $windowSeconds) {
                $timestamps[] = $ts;
            }
        }
    }
}
if (count($timestamps) >= $maxRequests) {
    http_response_code(429);
    echo json_encode([
        'ok' => false,
        'error' => 'Too many requests. Please wait a few minutes and try again.',
    ]);
    exit;
}
$timestamps[] = $now;
@file_put_contents($rateFile, json_encode($timestamps), LOCK_EX);

// 4. Extract and validate form fields
$firstName = get_field($input, ['FirstName', 'first_name', 'name-2', 'Name-1'], 256);
$lastName  = get_field($input, ['LastName', 'last_name', 'Name-2'], 256);
$email     = get_field($input, ['Email', 'email'], 256);
$phone     = get_field($input, ['Phone', 'phone'], 64);
$details   = get_field($input, ['Details', 'details'], 5000);
$lang      = get_field($input, ['lang', 'language'], 10);
$lang      = ($lang === 'ar') ? 'ar' : 'en';

// Extract HelpTopics (array or comma-separated string)
$helpTopics = [];
$rawTopics = $input['HelpTopics'] ?? ($input['checkbox'] ?? []);
if (is_array($rawTopics)) {
    foreach ($rawTopics as $topic) {
        if (is_string($topic) && trim($topic) !== '' && trim($topic) !== 'on') {
            $helpTopics[] = mb_substr(trim($topic), 0, 200, 'UTF-8');
        }
    }
} elseif (is_string($rawTopics) && trim($rawTopics) !== '' && trim($rawTopics) !== 'on') {
    $helpTopics[] = mb_substr(trim($rawTopics), 0, 200, 'UTF-8');
}

// Validate required fields
if ($phone === '' || $details === '') {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'error' => ($lang === 'ar')
            ? 'يرجى إدخال رقم التليفون والتفاصيل المطلوبة.'
            : 'Please provide both your phone number and details.',
    ]);
    exit;
}

if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'error' => ($lang === 'ar')
            ? 'يرجى إدخال بريد إلكتروني صحيح.'
            : 'Please enter a valid email address.',
    ]);
    exit;
}

$fullName = trim($firstName . ' ' . $lastName);
$displayIdentifier = $fullName !== '' ? $fullName : ($email !== '' ? $email : $phone);
$topicsDisplay = !empty($helpTopics) ? implode(', ', $helpTopics) : 'None selected';
$submittedAt = gmdate('Y-m-d H:i:s \U\T\C');

// 5. Write durable local backup log before external API call
$logDir = '/var/log/bookit-support';
if (!is_dir($logDir) || !is_writable($logDir)) {
    $logDir = '/tmp';
}
$logEntry = json_encode([
    'timestamp'  => $submittedAt,
    'lang'       => $lang,
    'first_name' => $firstName,
    'last_name'  => $lastName,
    'email'      => $email,
    'phone'      => $phone,
    'topics'     => $helpTopics,
    'details'    => $details,
    'ip'         => $clientIp,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL;
@file_put_contents($logDir . '/support-submissions.log', $logEntry, FILE_APPEND | LOCK_EX);

// 6. Load Brevo API key from environment or instance configuration file
$brevoApiKey = getenv('BREVO_API_KEY') ?: '';
if ($brevoApiKey === '' && is_readable('/etc/bookit/brevo_api_key')) {
    $brevoApiKey = trim((string) @file_get_contents('/etc/bookit/brevo_api_key'));
}

$recipientEmail = getenv('SUPPORT_RECIPIENT_EMAIL') ?: 'go@bookit-app.com';
$senderEmail    = getenv('SUPPORT_SENDER_EMAIL') ?: 'go@bookit-app.com';
$senderName     = getenv('SUPPORT_SENDER_NAME') ?: 'Bookit Support Form';

if ($brevoApiKey === '') {
    error_log('[bookit-support] Missing Brevo API key (/etc/bookit/brevo_api_key)');
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => 'Server configuration error. Please contact +201157111401.',
    ]);
    exit;
}

// Escape values for HTML email
$esc = static fn(string $s): string => htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$detailsHtml = nl2br($esc($details));

$htmlContent = <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>New Bookit Support Inquiry</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color: #1f2937; line-height: 1.5; padding: 20px;">
  <div style="max-width: 640px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden;">
    <div style="background-color: #790077; color: #ffffff; padding: 16px 24px;">
      <h2 style="margin: 0; font-size: 18px;">New Support Form Submission ({$esc(strtoupper($lang))})</h2>
    </div>
    <div style="padding: 24px;">
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <tr>
          <td style="padding: 8px 0; font-weight: 600; width: 150px; border-bottom: 1px solid #f3f4f6;">Name:</td>
          <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6;">{$esc($fullName !== '' ? $fullName : '—')}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: 600; border-bottom: 1px solid #f3f4f6;">Email:</td>
          <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6;">{$esc($email !== '' ? $email : '—')}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: 600; border-bottom: 1px solid #f3f4f6;">Phone:</td>
          <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6;"><a href="tel:{$esc($phone)}" style="color: #790077;">{$esc($phone)}</a></td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: 600; border-bottom: 1px solid #f3f4f6;">Help Topics:</td>
          <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6;">{$esc($topicsDisplay)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: 600; border-bottom: 1px solid #f3f4f6;">Submitted At:</td>
          <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6;">{$esc($submittedAt)} (IP: {$esc($clientIp)})</td>
        </tr>
      </table>
      <div style="background-color: #f9fafb; border-left: 4px solid #790077; padding: 16px; border-radius: 4px;">
        <div style="font-weight: 600; margin-bottom: 8px;">Details:</div>
        <div>{$detailsHtml}</div>
      </div>
    </div>
  </div>
</body>
</html>
HTML;

$textContent = "New Bookit Support Inquiry (" . strtoupper($lang) . ")\n"
    . "========================================\n"
    . "Name:         " . ($fullName !== '' ? $fullName : '—') . "\n"
    . "Email:        " . ($email !== '' ? $email : '—') . "\n"
    . "Phone:        " . $phone . "\n"
    . "Help Topics:  " . $topicsDisplay . "\n"
    . "Submitted At: " . $submittedAt . " (IP: " . $clientIp . ")\n\n"
    . "Details:\n"
    . $details . "\n";

$payload = [
    'sender' => [
        'name'  => $senderName,
        'email' => $senderEmail,
    ],
    'to' => [
        [
            'email' => $recipientEmail,
            'name'  => 'Bookit Support',
        ],
    ],
    'subject'     => "[Bookit Support] Inquiry from {$displayIdentifier}",
    'htmlContent' => $htmlContent,
    'textContent' => $textContent,
];

if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL)) {
    $payload['replyTo'] = [
        'email' => $email,
        'name'  => $fullName !== '' ? $fullName : $email,
    ];
}

// 7. Send via Brevo v3 SMTP API
$ch = curl_init('https://api.brevo.com/v3/smtp/email');
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER     => [
        'Accept: application/json',
        'Content-Type: application/json',
        'api-key: ' . $brevoApiKey,
    ],
    CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    CURLOPT_TIMEOUT        => 10,
    CURLOPT_CONNECTTIMEOUT => 5,
]);

$responseBody = curl_exec($ch);
$curlErr      = curl_error($ch);
$httpStatus   = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($responseBody === false || $httpStatus < 200 || $httpStatus >= 300) {
    error_log(sprintf(
        '[bookit-support] Brevo send failed (HTTP %d): %s %s',
        $httpStatus,
        $curlErr,
        is_string($responseBody) ? $responseBody : ''
    ));
    http_response_code(502);
    echo json_encode([
        'ok' => false,
        'error' => ($lang === 'ar')
            ? 'عذراً، تعذر إرسال رسالتك حالياً. يرجى المحاولة مرة أخرى.'
            : 'Unable to send your message right now. Please try again shortly.',
    ]);
    exit;
}

http_response_code(200);
echo json_encode([
    'ok' => true,
    'message' => ($lang === 'ar')
        ? 'شكراً لتواصلك معنا! تم استلام رسالتك بنجاح.'
        : 'Thank you! Your submission has been received!',
]);

