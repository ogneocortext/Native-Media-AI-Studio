# Confirm which backtick-letter pairs produce control chars
foreach ($pair in @('a','b','e','t','n','0','r','"',"'",'`','u','f')) {
    $eval = '"' + [char]0x60 + $pair + '"'
    $val = Invoke-Expression $eval
    $codes = ($val.ToCharArray() | ForEach-Object { 'U+{0:X4}' -f [int]$_ }) -join ' '
    "``$pair -> $codes"
}
# and the killer case: markdown code span inside expandable string
$md = @"
Use the ``audioFile`` prop and `` `title` `` field.
"@
"--- expandable here-string result ---"
$md.ToCharArray() | ForEach-Object { '{0} U+{1:X4}' -f $_, [int]$_ } | Select-Object -First 40
