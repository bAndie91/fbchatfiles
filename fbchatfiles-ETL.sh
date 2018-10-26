#!/bin/bash

set -e
set -u

#libs=/usr/local/lib/fbchatfiles
libs=`dirname "$(readlink -f "$0")"`
statedir=~/.local/share/fbchatfiles
datadir=${1?Specify data directory in first parameter.}
PROCNAME=$0 ; PROCNAME=${PROCNAME##*/}

warnx()
{
	echo "$PROCNAME: $*" >&2
}

mkdir -p "$statedir"
chmod o-x "$statedir"
cd "$statedir"

set +u
export NODE_PATH=$libs/node${NODE_PATH:+:}$NODE_PATH
set -u
export FBCHATFILES_APISTATE=$statedir/cookies.json

warnx Testing Facebook login.
if ! node $libs/login_check.js
then
	warnx Facebook login failed. Extracting cookies from Vivaldi.
	PATH=$libs:$PATH $libs/convert_cookies_chromium_to_nodejs.sh >"$FBCHATFILES_APISTATE"
fi

export FBCHATFILES_STATE=$statedir/state.json

warnx Extracting attachments from Messenger conversations
node $libs/fbchatfiles.js

mkdir -p "$datadir"
cd "$datadir"
warnx Downloading attachments
$libs/fbchatfiles.sh
