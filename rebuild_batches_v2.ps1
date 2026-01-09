$all = @(Get-Content 'c:\Users\User\Desktop\BA-AI-PROJECT\query')
$users = $all[2..19895]

Write-Host "Total users: $($users.Count)"

# Create SQL template
$sqlTemplate = @'
-- Batch {0}: Users {1}-{2}
WITH ids AS (
  SELECT account_user_id
  FROM (VALUES
{3}
  ) AS v(account_user_id)
),
deposits AS (
  SELECT 
    account_user_id, 
    SUM(amount) AS deposit_amount
  FROM default.ads_mcd_cx_deposit_transaction
  WHERE account_user_id IN (SELECT account_user_id FROM ids)
  AND status_name = 'Approved'
  GROUP BY account_user_id
),
withdrawals AS (
  SELECT 
    account_user_id, 
    SUM(amount) AS withdrawal_amount
  FROM default.ads_mcd_cx_withdraw_transaction
  WHERE account_user_id IN (SELECT account_user_id FROM ids)
  AND status_name = 'Approved'
  GROUP BY account_user_id
)
SELECT
  i.account_user_id,
  COALESCE(d.deposit_amount, 0) AS deposit_amount,
  COALESCE(w.withdrawal_amount, 0) AS withdrawal_amount,
  COALESCE(w.withdrawal_amount, 0) - COALESCE(d.deposit_amount, 0) AS net_loss
FROM ids i
LEFT JOIN deposits d ON i.account_user_id = d.account_user_id
LEFT JOIN withdrawals w ON i.account_user_id = w.account_user_id
ORDER BY net_loss DESC;
'@

# Format batch users to SQL - one per line
function Format-Users($userArray) {
    $lines = @()
    for ($i = 0; $i -lt $userArray.Count; $i++) {
        if ($i -eq $userArray.Count - 1) {
            # Last user - no comma
            $lines += "    ('$($userArray[$i])')"
        } else {
            # Other users - with comma
            $lines += "    ('$($userArray[$i])'),"
        }
    }
    return $lines -join "`n"
}

# Generate all 4 batches
$batches = @(
    @{num=1; start=1; end=5000; users=$users[0..4999]},
    @{num=2; start=5001; end=10000; users=$users[5000..9999]},
    @{num=3; start=10001; end=15000; users=$users[10000..14999]},
    @{num=4; start=15001; end=$users.Count; users=$users[15000..($users.Count-1)]}
)

foreach ($batch in $batches) {
    $userList = Format-Users $batch.users
    $sql = $sqlTemplate -f $batch.num, $batch.start, $batch.end, $userList
    $filename = "c:\Users\User\Desktop\BA-AI-PROJECT\query_batch_$($batch.num).sql"
    Set-Content -Path $filename -Value $sql -Encoding UTF8
    Write-Host "Created $filename with $($batch.users.Count) users"
}
