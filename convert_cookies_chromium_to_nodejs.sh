#!/bin/bash

vivaldiCookieFile=~/.config/vivaldi/Default/Cookies

LD_PRELOAD=/usr/lib/yazzy-preload/ignore_read_lock.so \
sqlite3 -noheader "$vivaldiCookieFile" .dump 2>/dev/null |\
{
sed -e '/^CREATE INDEX/d'
echo "SELECT host_key, path, name,
	datetime(creation_utc / 1000000 + (strftime('%s', '1601-01-01')), 'unixepoch'), 
	datetime(last_access_utc / 1000000 + (strftime('%s', '1601-01-01')), 'unixepoch'),
	hex(encrypted_value)
	FROM cookies WHERE host_key IN ('.facebook.com', 'facebook.com', '.messenger.com', 'messenger.com');"
}|\
sqlite3 -list -noheader :memory: 2>/dev/null |\
CHROMIUM_DECRYPT_PASS=peanuts chromium_cookie_decrypt.py 7 |\
{
n=0
echo "["
while read -r host_key path name createdDate createdTime last_accessDate last_accessTime value
do
	host_key=${host_key#.}
	
	[ $n -gt 0 ] && echo ,
	
	echo -n "	{
		\"creation\": \"${createdDate}T${createdTime}.000Z\",
		\"lastAccessed\": \"${last_accessDate}T${last_accessTime}.000Z\",
		\"domain\": \"$host_key\",
		\"path\": \"$path\",
		\"key\": \"$name\",
		\"value\": \"$value\",
		\"hostOnly\": false
	}"
	
	n=$((n+1))
done
echo
echo "]"
}
