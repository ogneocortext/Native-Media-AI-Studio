# Verify PowerShell backtick-escape mangling theory
$s = "``audioFile``"
"double-quoted: " + ([int[]][char[]]$s -join ',')
$s2 = 'single-quoted ``audioFile``'
"single-quoted: " + ([int[]][char[]]$s2.Substring(0,12) -join ',')
$s3 = @"
markdown `` `code` `` span with ```tsx fence
"@
"here-string expandable:"
[char[]]$s3 | ForEach-Object { '{0} U+{1:X4}' -f $_, [int]$_ } | Select-Object -First 30
