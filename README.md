Usage
=====

Start with `fbchatfiles-ETL.sh DIRECTORY` where DIRECTORY is the location where you want 
to save files sent you as attachments in Facebook Messenger.

It stores some state in `~/.local/share/fbchatfiles` directory. 
It steals cookies from Vivaldi browser to login to your Messenger account,
if first login attempt fails.

Then it runs `fbchatfiles.js` to save references to the the attachments in each 
conversation thread.
At last `fbchatfiles.sh` downloads the files to the DIRECTORY you have given.

You may run `fbchatfiles-ETL.sh` twice. if the first part (`fbchatfiles.js`) runs too long,
then the downloader part (`fbchatfiles.sh`) might get 403 errors due to the expired access
period. Running the whole ETL again likely will run faster so you less likely will get
access denied errors more.


Files
=====

A file `.fbchatfiles` indicates that this directory is managed by `fbchatfiles`.

In download directory dot-directories are created for each conversation, 
conversation-wise files are saved in them.
Symlinks are also made to the "dot id number" directories whiches name indicates 
the conversation's friendly name.

example:

```
John Doe (164566767522792) -> .164566767522792
John Doe, Mary Smith, Jack Doe (162862575657673) -> .162862575657673
named thread heeeyy (191458793565494) -> .191458793565494
```

In each conversation directory there is a file called `.files` which contains the
attachment IDs and the file names under which name they were saved.
You can delete downloaded files and they won't be downloaded again.
You can remove the line from `.files` corresponding to the deleted file so `fbchatfiles`
will try to download it again (since it does not know about it).

Shared URLs are saved in `.url` files with the page's title in filename and the URL in the content.

Linked video pages are passed to `youtube-dl` to download.

