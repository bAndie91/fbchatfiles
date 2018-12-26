#!/bin/bash

set -e -u -o pipefail

sanitize()
{
	local str newstr
	str=$1
	while true
	do
		newstr=`echo "$str" | sed -e 's,\.\./,,g; s,/\.\.,,g'`
		if [ "$str" = "$newstr" ]
		then
			break
		fi
		str=$newstr
	done
	echo "$newstr"
}

bytelength()
{
	(
		LC_ALL=C
		LANG=C
		echo ${#1}
	)
}

shorten()
{
	local str=$1
	local max=$2
	local abbrev=''
	local n=0
	while [ `bytelength "$str$abbrev"` -gt $max ]
	do
		n=$[n+1]
		str=${str%,*}
		abbrev=" +$n…"
	done
	echo "$str$abbrev"
}

errorlevel()
{
	return $1
}

declare -A EXTENSION_BY_MIME
get_ext_by_mime()
{
	local mime=$1
	if [ "${EXTENSION_BY_MIME[$mime]-}" ]
	then
		echo "${EXTENSION_BY_MIME[$mime]}"
	else
		while read -r mime_1 ext_1 ext_n
		do
			if [ "$mime_1" = "$mime" ]
			then
				echo "$ext_1"
				EXTENSION_BY_MIME[$mime]=$ext_1
				break
			fi
		done </etc/mime.types
	fi
}

get_version_max()
{
	local basename=$1
	local ext=$2
	
	{
		find -maxdepth 1 -name '*.url'
		awk '{$1=""; print $0}' .files
	}|\
	{
		maxsn=0
		len=`bytelength "$basename"`
		
		while read -r testfilename
		do
			left=${testfilename:0:$len}
			if [ "$left" = "$basename" ]
			then
				right=${testfilename:$len}
				if [ "$right" = "${ext:+.}$ext" ]
				then
					[ $maxsn -gt 1 ] || maxsn=1
				elif [[ $right =~ ^\ \(([0-9]+)\)${ext:+.}$ext$ ]]
				then
					sn=${BASH_REMATCH[1]}
					[ $maxsn -gt $sn ] || maxsn=$sn
				fi
			fi
		done
		
		echo $maxsn
	}
}

url2basefilename()
{
	local url=$1
	local filename=${url%%\?*}
	filename=`basename "$filename"`
	echo "$filename"
}

report_forbidden_url()
{
	cat "$FBCHATFILES_STATE" |\
	jq -r ". * {\"threads\":{\"$1\":{\"file\":{\"$2\":{\"failed\":true}}}}}" \
	>"$FBCHATFILES_STATE".new
	mv "$FBCHATFILES_STATE".new "$FBCHATFILES_STATE"
}

is_empty_dir()
{
	[ "$(cd "$1" && find . -maxdepth 0 -empty)" = . ]
}



if [ -e .fbchatfiles ] || is_empty_dir .
then
	true
else
	echo "CWD is neither an empty nor a FB Chat directory." >&2
	exit 1
fi


cat "$FBCHATFILES_STATE" |\
jq -r '.threads | to_entries | sort_by(.timestamp) | reverse | .[] | .value+{"key":.key} |
	select(.file|keys[0]) |
	[
		.key,
		.timestamp,
		.conversationName,
		(.file | length | tostring),
		(.file | to_entries[] | .value+{"key":.key} | 
			[.key, .time, (.islink | tostring), .url // "-", .name] | join(" "))
	] |
	join("\n")' |\
{

NAME_MAX=`getconf NAME_MAX .`

#find -maxdepth 1 -type l -delete

while read -r threadID
do
	read -r thread_timestamp_msec
	read -r conversationName
	read -r numFiles
	
	threadID=`sanitize "$threadID"`
	dir=`sanitize ".$threadID"`
	conversationName=`sanitize "$conversationName"`
	
	echo "$threadID $conversationName ($numFiles)" >&2
	
	if [ $numFiles -gt 0 ]
	then
		link="$(shorten "$conversationName" $[NAME_MAX - ${#threadID} - 3]) ($threadID)"
		
		touch .fbchatfiles
		[ -d "$dir" ] || mkdir "$dir"
		ln -sfn "$dir" "$link"
		
		(
			set -e -u -o pipefail
			cd "$dir"
			[ -e .files ] || touch .files
			
			for n in `seq 1 $numFiles`
			do
				read -r fileID timestamp_msec is_link url filename
				timestamp=${timestamp_msec:0:-3}
				filename=`sanitize "$filename"`
				written=false
				
				if [ -z "$filename" ]
				then
					filename=`url2basefilename "$url"`
				fi
				
				if expr "$filename" : '.*/' >/dev/null
				then
					filename=$fileID
				fi
				
				if [ -n "$filename" -a "$url" != - ]
				then
					if awk '$1=="'$fileID'"{exit 1}' .files
					then
						if [ "$is_link" = true ]
						then
							if [[ $url =~ ^https://facebook\.com[^?]\.(jpg|mp4)(\?|$) ]]
							then
								is_link=false
								filename=`url2basefilename "$url"`
							fi
						fi
						
						if [ "$is_link" = true ]
						then
							if [ "$(echo "$url" | cut -d/ -f3,5)" = www.facebook.com/posts ]
							then
								# Download potential videos on linked page
								set +e
								filename=`youtube-dl --get-filename "$url"`
								err=$?
								set -e
								if [ $err = 0 ]
								then
									if youtube-dl --xattrs "$url"
									then
										written=true
									else
										# TODO check exit code
										report_forbidden_url "$threadID" "$fileID"
									fi
								else
									echo "Could not download video: $url" >&2
								fi
								unset err
							else
								ext=url
								ver=`get_version_max "$filename" "$ext"`
								case $ver in
								0)
									filename=$filename.$ext
									;;
								1)
									mv "$filename.$ext" "$filename (1).$ext"
									filename="$filename (2).$ext"
									;;
								*)
									filename="$filename ($[ver+1]).$ext"
									;;
								esac
								
								echo "$url" > "$filename"
								written=true
							fi
						else
							echo "Downloading '$url' to '$filename'" >&2
							[ ! -e "$filename.part" ] || rm "$filename.part"
							set +e
							wget "$url" -qO "$filename.part"
							err=$?
							set -e
							if [ $err != 0 -a -f "$filename.part" -a ! -s "$filename.part" ]
							then
								rm "$filename.part"
							fi
							case $err in
							0)	
								mv "$filename.part" "$filename"
								written=true
								;;
							8)	
								report_forbidden_url "$threadID" "$fileID"
								echo "Forbidden to download '$url' to '$filename'" >&2
								;;
							*)	
								echo "Download Error (wget) $err" >&2
								errorlevel $err
								;;
							esac
							unset err
							
							if [ $written = true ]
							then
								if ! expr "$filename" : '.*\..' >/dev/null
								then
									mime=`file --brief --mime-type "$filename"`
									ext=`get_ext_by_mime "$mime"`
									if [ -n "$ext" ]
									then
										mv "$filename" "$filename.$ext"
										filename=$filename.$ext
									fi
								fi
							fi
						fi
						
						if [ $written = true ]
						then
							echo "$fileID	$filename" >> .files
							touch -d "@$timestamp" "$filename"
						fi
					fi
				fi
			done
		)
		
		touch -h -d "@${thread_timestamp_msec:0:-3}" "$dir" "$link"
	fi
done

}


#cat "$FBCHATFILES_STATE" | jq -r '[.threads[].file[] | select(.failed)] | length'
