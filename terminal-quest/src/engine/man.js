'use strict';
/*
 * Terminal Quest — in-game manual pages.
 * Simplified but faithful to the real man pages, with game-flavoured examples.
 */

const B = (s) => `\x1b[1m${s}\x1b[0m`;

function page(name, section, oneline, synopsis, description, options, examples) {
  let p = `${B(name.toUpperCase() + '(' + section + ')')}                 Terminal Quest Manual\n\n`;
  p += `${B('NAME')}\n       ${name} - ${oneline}\n\n`;
  p += `${B('SYNOPSIS')}\n       ${synopsis}\n\n`;
  p += `${B('DESCRIPTION')}\n${description.split('\n').map(l => '       ' + l).join('\n')}\n`;
  if (options && options.length) {
    p += `\n${B('OPTIONS')}\n`;
    for (const [flag, desc] of options) p += `       ${B(flag.padEnd(14))} ${desc}\n`;
  }
  if (examples && examples.length) {
    p += `\n${B('EXAMPLES')}\n`;
    for (const [cmd, desc] of examples) p += `       $ ${cmd}\n              ${desc}\n`;
  }
  return p;
}

const MAN_PAGES = {};

MAN_PAGES.whoami = page('whoami', 1, 'print effective user name',
  'whoami',
  'Print the user name associated with the current session.\nUseful when you have just logged in to an unfamiliar machine\n(or woken up at a strange desk at OmniCorp).',
  [],
  [['whoami', 'prints your current username, e.g. player']]);

MAN_PAGES.pwd = page('pwd', 1, 'print name of current/working directory',
  'pwd',
  'Print the full, absolute path of the current working directory.\nEvery shell session is always "somewhere" in the filesystem tree;\npwd tells you where.',
  [],
  [['pwd', 'e.g. /home/player — you are in your home directory']]);

MAN_PAGES.ls = page('ls', 1, 'list directory contents',
  'ls [OPTION]... [FILE]...',
  'List information about FILEs (the current directory by default).\nEntries are sorted alphabetically.',
  [
    ['-a', 'do not ignore entries starting with . (hidden files)'],
    ['-l', 'use a long listing format (permissions, owner, size, date)'],
    ['-R', 'list subdirectories recursively']
  ],
  [
    ['ls -la /etc', 'long listing of /etc including hidden files'],
    ['ls -R /var/log', 'list every file under /var/log recursively']
  ]);

MAN_PAGES.clear = page('clear', 1, 'clear the terminal screen',
  'clear',
  'Clear the terminal scrollback so you can think again.\nPurely cosmetic: files and state are unaffected.',
  [], [['clear', 'wipe the screen']]);

MAN_PAGES.exit = page('exit', 1, 'exit the shell',
  'exit',
  'End the current shell session. If you elevated with su, exit drops\nyou back to your normal user. Your quest progress is saved\nautomatically, so closing the window is always safe.',
  [], []);

MAN_PAGES.cd = page('cd', 1, 'change the working directory',
  'cd [DIRECTORY]',
  'Change the current directory. With no argument, go to your home\ndirectory. Paths may be absolute (starting with /) or relative to\nwhere you are now.\n\n  cd ..    go up one level\n  cd ~     go to your home directory\n  cd -     go back to the previous directory',
  [],
  [
    ['cd /var/log', 'jump straight to /var/log (absolute path)'],
    ['cd ../archive', 'go up one level, then into archive (relative path)']
  ]);

MAN_PAGES.mkdir = page('mkdir', 1, 'make directories',
  'mkdir [OPTION]... DIRECTORY...',
  'Create the DIRECTORY(ies), if they do not already exist.',
  [['-p', 'make parent directories as needed; no error if existing']],
  [
    ['mkdir reports', 'create the directory "reports" here'],
    ['mkdir -p projects/2026/q1', 'create the whole path at once']
  ]);

MAN_PAGES.touch = page('touch', 1, 'create empty files / update timestamps',
  'touch FILE...',
  'Update the modification time of each FILE to the current time.\nA FILE that does not exist is created empty. The classic way to\ncreate a quick placeholder file.',
  [],
  [['touch notes.txt', 'create an empty notes.txt (or refresh its timestamp)']]);

MAN_PAGES.rm = page('rm', 1, 'remove files or directories',
  'rm [OPTION]... FILE...',
  'Remove (delete) each specified FILE. By default, rm does not remove\ndirectories. THERE IS NO TRASH CAN — on a real system rm is forever,\nso read twice, delete once. At OmniCorp, backups live in /var/backups\n(you may need them one day).',
  [
    ['-r, -R', 'remove directories and their contents recursively'],
    ['-f', 'ignore nonexistent files, never prompt']
  ],
  [
    ['rm old_draft.txt', 'delete one file'],
    ['rm -r build/', 'delete the build directory and everything inside']
  ]);

MAN_PAGES.rmdir = page('rmdir', 1, 'remove empty directories',
  'rmdir DIRECTORY...',
  'Remove the DIRECTORY(ies), only if they are empty. A safe way to\nclean up: it refuses to delete anything that still has contents.',
  [],
  [['rmdir tmp/', 'remove tmp only if nothing is left inside']]);

MAN_PAGES.cp = page('cp', 1, 'copy files and directories',
  'cp [OPTION]... SOURCE... DEST',
  'Copy SOURCE to DEST, or multiple SOURCEs to a DEST directory.\nThe original file is left untouched.',
  [['-r, -R', 'copy directories recursively']],
  [
    ['cp report.txt report.bak', 'make a backup copy'],
    ['cp -r /var/backups/www /srv/www', 'restore a whole directory tree']
  ]);

MAN_PAGES.mv = page('mv', 1, 'move (rename) files',
  'mv [OPTION]... SOURCE... DEST',
  'Rename SOURCE to DEST, or move SOURCE(s) into a DEST directory.\nMoving is instant even for big files — only the name changes.',
  [],
  [
    ['mv draft.txt final.txt', 'rename a file'],
    ['mv *.jpg photos/', 'move every .jpg into photos/']
  ]);

MAN_PAGES.cat = page('cat', 1, 'concatenate files and print on stdout',
  'cat [OPTION]... [FILE]...',
  'Print each FILE to standard output, one after another. The go-to\ntool for reading short files. For long files, prefer less.',
  [['-n', 'number all output lines']],
  [
    ['cat /etc/hostname', 'show the machine name'],
    ['cat part1.txt part2.txt > whole.txt', 'join two files into one']
  ]);

MAN_PAGES.less = page('less', 1, 'view file contents page by page',
  'less [FILE]',
  'A pager: shows a file one screen at a time. On real Linux you scroll\nwith arrows/PgDn, search with /pattern and quit with q. In this\nsimulation less prints the file with an (END) marker.',
  [],
  [['less /var/log/syslog', 'browse a long log comfortably']]);
MAN_PAGES.more = MAN_PAGES.less;

MAN_PAGES.head = page('head', 1, 'output the first part of files',
  'head [-n NUM] [FILE]...',
  'Print the first 10 lines of each FILE to standard output.\nReads from standard input when no FILE is given (great in pipes).',
  [['-n NUM', 'print the first NUM lines instead of 10']],
  [['head -n 3 access.log', 'the first three lines of the log']]);

MAN_PAGES.tail = page('tail', 1, 'output the last part of files',
  'tail [-n NUM] [FILE]...',
  'Print the last 10 lines of each FILE. Logs append at the bottom,\nso tail shows you the most recent events — usually what you want\nwhen something just broke.',
  [
    ['-n NUM', 'output the last NUM lines instead of 10'],
    ['-f', 'follow: keep printing as the file grows (simplified here)']
  ],
  [['tail -n 20 /var/log/syslog', 'the 20 most recent log lines']]);

MAN_PAGES.echo = page('echo', 1, 'display a line of text',
  'echo [-n] [STRING]...',
  'Print STRING(s) to standard output followed by a newline.\nCombined with redirection it becomes a tiny file writer:\n  echo hello > file.txt     (create/overwrite)\n  echo hello >> file.txt    (append)',
  [['-n', 'do not output the trailing newline']],
  [['echo $HOME', 'print the value of the HOME variable'],
   ['echo FLAG-123 > /dev/exit', 'submit a level flag in Terminal Quest']]);

MAN_PAGES.wc = page('wc', 1, 'print newline, word, and byte counts',
  'wc [-lwc] [FILE]...',
  'Count lines, words and bytes for each FILE, or for standard input.\nIn pipelines, wc -l is the classic "how many results?" tool.',
  [
    ['-l', 'print the newline (line) count'],
    ['-w', 'print the word count'],
    ['-c', 'print the byte count']
  ],
  [['grep ERROR app.log | wc -l', 'count how many error lines the log has']]);

MAN_PAGES.sort = page('sort', 1, 'sort lines of text files',
  'sort [OPTION]... [FILE]...',
  'Write sorted concatenation of FILE(s), or standard input, to\nstandard output. Sorting is the usual preparation step before uniq.',
  [
    ['-n', 'compare according to numerical value'],
    ['-r', 'reverse the result'],
    ['-u', 'output only unique lines'],
    ['-k N', 'sort by field number N'],
    ['-t SEP', 'use SEP as the field separator']
  ],
  [['sort -t, -k2 users.csv', 'sort a CSV by its second column'],
   ['sort errors.txt | uniq -c | sort -nr', 'rank duplicate lines by frequency']]);

MAN_PAGES.uniq = page('uniq', 1, 'report or omit repeated lines',
  'uniq [OPTION]... [FILE]',
  'Filter ADJACENT matching lines, writing one copy of each.\nBecause only adjacent duplicates are merged, you almost always\nsort first: sort file | uniq',
  [
    ['-c', 'prefix lines by the number of occurrences'],
    ['-d', 'only print duplicated lines']
  ],
  [['sort codes.txt | uniq -c', 'count how often each line appears']]);

MAN_PAGES.grep = page('grep', 1, 'print lines that match patterns',
  'grep [OPTION]... PATTERN [FILE]...',
  'Search for PATTERN in each FILE (or standard input) and print each\nmatching line. PATTERN is a regular expression. The single most\nimportant investigation tool an admin owns.',
  [
    ['-i', 'ignore case distinctions'],
    ['-v', 'invert: select non-matching lines'],
    ['-n', 'prefix each match with its line number'],
    ['-c', 'print only a count of matching lines'],
    ['-l', 'print only names of files with matches'],
    ['-r', 'read all files under each directory, recursively']
  ],
  [
    ['grep -i error /var/log/syslog', 'find errors regardless of case'],
    ['grep -r "SECRET_RECIPE" /data', 'hunt a string through a whole tree'],
    ['ps aux | grep nginx', 'filter another command’s output']
  ]);

MAN_PAGES.find = page('find', 1, 'search for files in a directory hierarchy',
  'find [PATH...] [EXPRESSION]',
  'Walk the directory tree below each PATH and print every entry that\nmatches the expression. Where grep searches file CONTENTS, find\nsearches file NAMES and metadata (size, age, type).',
  [
    ['-name PAT', 'file name matches shell pattern PAT (quote it!)'],
    ['-iname PAT', 'like -name, case insensitive'],
    ['-type f|d', 'entry is a regular file / directory'],
    ['-size +N[k|M]', 'larger than N kilo/megabytes (- for smaller)'],
    ['-mtime +N', 'modified more than N days ago (-N: less than)'],
    ['-empty', 'file is empty or directory has no entries'],
    ['-delete', 'delete matching files (DANGEROUS — check first!)']
  ],
  [
    ['find /var -name "*.log"', 'every .log file under /var'],
    ['find /tmp -type f -mtime +30', 'files in /tmp older than 30 days'],
    ['find / -size +100M', 'what is eating the disk?']
  ]);

MAN_PAGES.du = page('du', 1, 'estimate file space usage',
  'du [OPTION]... [FILE]...',
  'Summarize disk usage of each FILE, recursively for directories.\nThe partner of df: df says the disk is full, du finds out WHY.',
  [
    ['-h', 'human-readable sizes (K, M, G)'],
    ['-s', 'display only a total for each argument']
  ],
  [['du -sh /var/*', 'which directory under /var is the big one?']]);

MAN_PAGES.df = page('df', 1, 'report file system disk space usage',
  'df [OPTION]...',
  'Show available and used disk space for the mounted filesystems.\nUse% at 100 means services start failing — act fast.',
  [['-h', 'human-readable sizes']],
  [['df -h', 'the classic first command when "the server is full"']]);

MAN_PAGES.chmod = page('chmod', 1, 'change file mode bits (permissions)',
  'chmod [-R] MODE FILE...',
  'Change the permissions of each FILE to MODE. Permissions come in\nthree triplets — user(owner), group, other — each with read(4),\nwrite(2) and execute(1) bits.\n\n  Octal:    chmod 750 file   ->  rwxr-x---\n  Symbolic: chmod u+x file   (add execute for the owner)\n            chmod o-rwx file (strip all rights from others)',
  [['-R', 'change files and directories recursively']],
  [
    ['chmod +x deploy.sh', 'make a script executable'],
    ['chmod 770 /srv/shared', 'owner and group full access, others none']
  ]);

MAN_PAGES.chown = page('chown', 1, 'change file owner and group',
  'chown [-R] OWNER[:GROUP] FILE...',
  'Change the ownership of each FILE. Only root may give files away —\nwhich is precisely why sysadmins get the big desk.',
  [['-R', 'operate on files and directories recursively']],
  [
    ['chown alex report.txt', 'make alex the owner'],
    ['chown -R www:devteam /srv/www', 'hand a tree to user www, group devteam']
  ]);

MAN_PAGES.ps = page('ps', 1, 'report a snapshot of current processes',
  'ps [aux]',
  'Display information about running processes. Plain ps shows your\nown; the famous "ps aux" shows every process on the system with\nowner, PID, CPU and memory usage.',
  [['aux', 'all processes, user-oriented format, incl. no-tty']],
  [['ps aux | grep miner', 'find a suspicious process and its PID']]);

MAN_PAGES.top = page('top', 1, 'display Linux processes',
  'top',
  'Show a dynamic, sorted view of the busiest processes. In this\nsimulation top prints one snapshot, sorted by CPU usage — the\nprocess at the top of the list is your prime suspect.',
  [],
  [['top', 'who is burning all the CPU?']]);

MAN_PAGES.kill = page('kill', 1, 'send a signal to a process',
  'kill [-SIGNAL] PID...',
  'Send a signal to the process with the given PID (find it with ps).\nThe default signal, SIGTERM (15), asks a process to shut down\ncleanly. SIGKILL (9) cannot be ignored — the kernel simply ends\nthe process. Try 15 first; escalate to 9 when a process refuses.',
  [
    ['-15, -TERM', 'polite termination request (default)'],
    ['-9, -KILL', 'forceful, unignorable kill']
  ],
  [
    ['kill 4242', 'ask process 4242 to stop'],
    ['kill -9 4242', 'end it, no questions asked']
  ]);

MAN_PAGES.jobs = page('jobs', 1, 'list background jobs of this shell',
  'jobs',
  'List the jobs started from this shell with & (background).\nUse fg %N to bring one to the foreground, bg %N to resume it\nin the background.',
  [],
  [['sleep 300 &', 'start a background job'], ['jobs', 'see it listed as [1]']]);
MAN_PAGES.fg = page('fg', 1, 'bring a job to the foreground', 'fg [%N]',
  'Move the given background job (default: the most recent) into the\nforeground.', [], [['fg %1', 'foreground job number 1']]);
MAN_PAGES.bg = page('bg', 1, 'resume a job in the background', 'bg [%N]',
  'Resume a stopped job, keeping it in the background.', [], []);
MAN_PAGES.sleep = page('sleep', 1, 'delay for a specified time', 'sleep SECONDS',
  'Pause for SECONDS. Mostly useful with & to practise job control:\n  sleep 300 &', [], []);

MAN_PAGES.ping = page('ping', 8, 'send ICMP ECHO_REQUEST to network hosts',
  'ping [-c COUNT] DESTINATION',
  'Check whether a host is reachable and how long packets take.\n100% packet loss means the host (or the path to it) is down —\nthe first question of every network diagnosis.',
  [['-c COUNT', 'stop after sending COUNT packets']],
  [['ping -c 3 webserver01', 'is the web server alive?']]);

MAN_PAGES.ip = page('ip', 8, 'show / manipulate network devices and addresses',
  'ip addr | ip link set DEV up|down',
  '"ip addr" lists network interfaces with their IP addresses and\nstate (UP/DOWN). An interface that is DOWN moves no packets at all,\nno matter how healthy everything else is. (Root can bring one up\nwith: ip link set eth0 up.)',
  [],
  [['ip addr', 'show interfaces — is eth0 UP and does it have an inet address?']]);
MAN_PAGES.ifconfig = page('ifconfig', 8, 'configure a network interface (legacy)',
  'ifconfig [INTERFACE] [up|down]',
  'The traditional interface tool, still found everywhere. Shows\naddresses and interface status; "ifconfig eth0 up" enables a device\n(root only). Modern systems prefer ip(8).',
  [], [['ifconfig', 'overview of all interfaces']]);

MAN_PAGES.netstat = page('netstat', 8, 'print network connections and listening ports',
  'netstat [-tulpn]',
  'List sockets: which ports are LISTENing, and which connections are\nESTABLISHED to whom. Unexpected listeners and strange foreign\naddresses are exactly how you spot intruders. (All flag combinations\nprint the same table in this simulation.)',
  [],
  [['netstat -tulpn', 'which programs are listening on which ports?']]);

MAN_PAGES.curl = page('curl', 1, 'transfer data from a URL',
  'curl [-I] URL',
  'Fetch a URL and print the response body. If ping answers but curl\ndoes not, the host is up but the SERVICE on that port is not.',
  [['-I', 'fetch headers only (HEAD request)']],
  [['curl http://webserver01/status', 'ask the web app how it feels']]);

MAN_PAGES.ssh = page('ssh', 1, 'OpenSSH remote login client',
  'ssh [USER@]HOST [COMMAND]',
  'Log in to a remote machine, or run a single COMMAND there. OmniCorp\nhosts accept key authentication only: create a key with ssh-keygen\nand install it with ssh-copy-id first.\n(Interactive remote shells are simplified to single commands here.)',
  [],
  [
    ['ssh backup@backup01 ls /vault', 'list a remote directory'],
    ['ssh backup@backup01 cat /etc/motd', 'read a remote file']
  ]);
MAN_PAGES.scp = page('scp', 1, 'OpenSSH secure file copy',
  'scp [USER@]HOST:REMOTE_PATH LOCAL_PATH\n       scp LOCAL_PATH [USER@]HOST:REMOTE_PATH',
  'Copy files between hosts over SSH. The remote side is written\nhost:path — the colon is what makes it remote.',
  [],
  [['scp backup@backup01:/vault/keys.tar .', 'download a remote file to here']]);
MAN_PAGES['ssh-keygen'] = page('ssh-keygen', 1, 'generate an SSH authentication key pair',
  'ssh-keygen',
  'Create a private key (~/.ssh/id_ed25519 — keep it secret!) and a\npublic key (id_ed25519.pub — share it freely). Hosts that know your\npublic key let you in without a password.',
  [],
  [['ssh-keygen', 'generate your key pair (accept the defaults)']]);
MAN_PAGES['ssh-copy-id'] = page('ssh-copy-id', 1, 'install your public key on a remote host',
  'ssh-copy-id [USER@]HOST',
  'Append your public key to the remote user’s authorized_keys so\nfuture ssh/scp connections succeed without a password.',
  [],
  [['ssh-copy-id backup@backup01', 'then: ssh backup@backup01 ls /']]);

MAN_PAGES.who = page('who', 1, 'show who is logged on',
  'who',
  'List current login sessions: user, terminal, login time and origin.\nA login you do not recognize is a five-alarm fire.',
  [], [['who', 'is anyone else on this machine right now?']]);
MAN_PAGES.last = page('last', 1, 'show a listing of last logged in users',
  'last',
  'Show recent logins, newest first, including where they came from.\nThe audit trail for "when did they get in?"',
  [], [['last', 'recent login history']]);

MAN_PAGES.crontab = page('crontab', 1, 'maintain crontab files (scheduled jobs)',
  'crontab FILE | crontab -l | crontab -r',
  'cron runs commands on a schedule. Each crontab line has five time\nfields then the command:\n\n  minute hour day-of-month month day-of-week command\n  30     2    *            *     *           /opt/scripts/clean.sh\n\nThat runs clean.sh every day at 02:30. * means "every".\nIn this simulation, write your schedule into a file and install it\nwith "crontab FILE" (interactive -e editing is not available).',
  [
    ['-l', 'list your current crontab'],
    ['-r', 'remove your crontab'],
    ['-u USER', '(root) operate on another user’s crontab']
  ],
  [
    ['echo "0 3 * * * /opt/scripts/backup.sh" > mycron', 'write a schedule'],
    ['crontab mycron', 'install it'],
    ['crontab -l', 'verify what is installed']
  ]);
MAN_PAGES.at = page('at', 1, 'execute a command once at a later time',
  'echo COMMAND | at TIME',
  'Schedule a one-shot job (cron is for repeating jobs, at for single\nones). In this simulation, pipe the command into at.',
  [],
  [['echo "/opt/scripts/report.sh" | at 02:00', 'run the report tonight at 2']]);

MAN_PAGES.sed = page('sed', 1, 'stream editor for filtering and transforming text',
  "sed [-n] [-i] 'SCRIPT' [FILE]",
  'Edit text as it streams through. The star command is substitution:\n\n  s/PATTERN/REPLACEMENT/     replace first match on each line\n  s/PATTERN/REPLACEMENT/g    replace ALL matches on each line\n\nAlso supported here: /re/d (delete lines), Nd, /re/p and N,Mp\n(print; combine with -n).',
  [
    ['-n', 'suppress automatic printing; use with p'],
    ['-i', 'edit the FILE in place instead of printing']
  ],
  [
    ["sed 's/HODOR/hodor/g' names.txt", 'lowercase every HODOR'],
    ["sed -n '1,5p' big.txt", 'print only lines 1-5'],
    ["sed '/^#/d' config", 'strip comment lines']
  ]);

MAN_PAGES.awk = page('awk', 1, 'pattern scanning and column processing',
  "awk [-F SEP] 'PROGRAM' [FILE]",
  'Process text line by line, splitting each line into fields $1, $2, …\n($0 is the whole line, NF the field count, NR the line number).\nThis simulation supports the workhorse form:\n\n  awk \'/pattern/ {print $1, $3}\'',
  [['-F SEP', 'use SEP as the field separator (e.g. -F, for CSV)']],
  [
    ["awk '{print $1}' access.log", 'first column of every line'],
    ["awk -F, '{print $2}' users.csv", 'second CSV column'],
    ["ps aux | awk '{print $2}'", 'just the PIDs']
  ]);

MAN_PAGES.bash = page('bash', 1, 'GNU Bourne-Again SHell / script interpreter',
  'bash SCRIPT [ARGS...]',
  'Run a shell script: a plain text file of commands, executed top to\nbottom. Scripts support variables (X=5, $X), positional arguments\n($1, $2, $#), loops and conditionals:\n\n  for f in *.txt; do echo "$f"; done\n  if [ -f /etc/passwd ]; then echo exists; fi\n  case $1 in start) echo go;; stop) echo halt;; esac\n\nStart scripts with the shebang line: #!/bin/bash',
  [],
  [['bash rename.sh', 'run rename.sh'], ['bash backup.sh full', 'run with $1=full']]);

MAN_PAGES.test = page('test', 1, 'check file types and compare values',
  'test EXPRESSION  |  [ EXPRESSION ]',
  'Evaluate EXPRESSION and set the exit status: 0 (true) or 1 (false).\nThe bracket form is what if statements use. Supported:\n  -e/-f/-d FILE   exists / is a file / is a directory\n  -s FILE         exists and is not empty\n  -z/-n STR       string is empty / not empty\n  A = B, A != B   string comparison\n  A -eq/-ne/-lt/-le/-gt/-ge B   numeric comparison',
  [],
  [['[ -f /etc/passwd ] && echo yes', 'file test in one line']]);
MAN_PAGES['['] = MAN_PAGES.test;

MAN_PAGES.man = page('man', 1, 'an interface to the system reference manuals',
  'man COMMAND',
  'Show the manual page for COMMAND. Learning to read man pages is\nitself the most transferable Linux skill in this whole game.',
  [], [['man grep', 'how do I search files again?']]);

MAN_PAGES.history = page('history', 1, 'display the command history',
  'history',
  'Print previously entered commands, numbered. Use the Up/Down arrow\nkeys to recall them at the prompt.',
  [], []);

MAN_PAGES.mail = page('mail', 1, 'read your OmniCorp mailbox',
  'mail',
  'Show messages your colleagues have sent you. Story briefings arrive\nhere; read them carefully — they contain your objectives.',
  [], []);

MAN_PAGES.tar = page('tar', 1, 'an archiving utility',
  'tar -xvf ARCHIVE.tar',
  'Extract files from a tar archive ("tarball"). Flags: x=extract,\nv=verbose, f=file. This simulation supports extraction only.',
  [], [['tar -xvf backup.tar', 'unpack backup.tar into the current directory']]);

MAN_PAGES.su = page('su', 1, 'switch user',
  'su [USER]',
  'Start a shell as another user (root by default) — if the target\naccount allows it. At OmniCorp, root access must be earned through\nstory events; you cannot simply su your way to glory.',
  [], []);
MAN_PAGES.sudo = page('sudo', 8, 'execute a command as the superuser',
  'sudo COMMAND',
  'Run a single command with root privileges — if you are in the\nsudoers file. Junior sysadmins start life outside that file.',
  [], []);
MAN_PAGES.passwd = page('passwd', 1, 'change user password',
  'passwd [USER]',
  'Change a password. Root may reset other users’ passwords — vital\nafter a compromise.', [], [['passwd svc-deploy', '(as root) reset a compromised account']]);

MAN_PAGES.cut = page('cut', 1, 'remove sections from each line of files',
  'cut -d SEP -f LIST [FILE]',
  'Print selected fields from each line, split on a delimiter.',
  [['-d SEP', 'field delimiter'], ['-f LIST', 'fields to keep, e.g. 1,3']],
  [['cut -d: -f1 /etc/passwd', 'just the usernames']]);

MAN_PAGES.tr = page('tr', 1, 'translate or delete characters',
  'tr [-d] SET1 [SET2]',
  'Replace characters of SET1 with the corresponding SET2 characters\n(reads standard input only — use it in pipes).',
  [['-d', 'delete characters in SET1']],
  [['echo hello | tr a-z A-Z', 'HELLO']]);

MAN_PAGES.xargs = page('xargs', 1, 'build command lines from standard input',
  'CMD | xargs COMMAND',
  'Take words from standard input and pass them as arguments to\nCOMMAND. Bridges "list producers" (find, grep -l) with "doers" (rm, cat).',
  [], [['find /tmp -name "*.tmp" | xargs rm', 'delete everything find found']]);

MAN_PAGES.uname = page('uname', 1, 'print system information', 'uname [-a]',
  'Print kernel and system information.', [['-a', 'print everything']], []);
MAN_PAGES.hostname = page('hostname', 1, 'show the system host name', 'hostname',
  'Print the name of the current host.', [], []);
MAN_PAGES.id = page('id', 1, 'print user identity', 'id',
  'Print your user id, group id and supplementary groups.', [], []);
MAN_PAGES.date = page('date', 1, 'print the system date and time', 'date',
  'Print the current (in-game) date and time.', [], []);
MAN_PAGES.uptime = page('uptime', 1, 'how long the system has been running', 'uptime',
  'Print current time, uptime, user count and load averages.', [], []);
MAN_PAGES.free = page('free', 1, 'display amount of free and used memory', 'free [-h]',
  'Show total, used and free memory.', [['-h', 'human readable']], []);
MAN_PAGES.tree = page('tree', 1, 'list contents of directories in a tree-like format', 'tree [DIR]',
  'Draw the directory hierarchy as a tree. Not part of the core levels,\nbut wonderfully readable.', [], []);
MAN_PAGES.diff = page('diff', 1, 'compare files line by line', 'diff FILE1 FILE2',
  'Show the lines that differ between two files. Exit status 0 means identical.',
  [], [['diff config config.bak', 'what changed?']]);
MAN_PAGES.ln = page('ln', 1, 'make links between files', 'ln -s TARGET LINKNAME',
  'Create a symbolic link: a small pointer file that refers to TARGET.',
  [['-s', 'make a symbolic link (the only kind supported here)']], []);
MAN_PAGES.seq = page('seq', 1, 'print a sequence of numbers', 'seq [FIRST] LAST',
  'Print numbers from FIRST (default 1) to LAST, one per line.\nHandy in for loops: for i in $(seq 1 5); do ...; done', [], []);
MAN_PAGES.which = page('which', 1, 'locate a command', 'which COMMAND',
  'Show the full path of a command.', [], []);
MAN_PAGES.env = page('env', 1, 'print environment variables', 'env',
  'List all environment variables of this shell.', [], []);
MAN_PAGES.export = page('export', 1, 'set an environment variable', 'export NAME=VALUE',
  'Set a variable that child processes (like scripts) will inherit.',
  [], [['export EDITOR=nano', 'set a variable for this session']]);
MAN_PAGES.file = page('file', 1, 'determine file type', 'file FILE...',
  'Guess what kind of data each FILE contains.', [], []);
MAN_PAGES.pkill = page('pkill', 1, 'signal processes by name', 'pkill PATTERN',
  'Kill all processes whose command line matches PATTERN.\nFaster than ps + kill when you know the name.', [],
  [['pkill cryptominer', 'no more mining on MY server']]);
MAN_PAGES.printf = page('printf', 1, 'format and print data', "printf FORMAT [ARG...]",
  'Print ARGs under control of FORMAT (%s string, %d number, \\n newline).',
  [], [["printf '%s\\n' hello", 'hello']]);
MAN_PAGES.hint = page('hint', 6, 'Terminal Quest: get a clue for the current puzzle',
  'hint',
  'Each call gives a progressively clearer clue for the current level.\nCosts a small amount of XP — mastery means solving unaided, but\nthere is no shame in asking. Alex certainly did, once.',
  [], []);
MAN_PAGES.submit = page('submit', 6, 'Terminal Quest: submit a level flag',
  'submit FLAG',
  'Equivalent to the canonical form:  echo FLAG > /dev/exit', [], []);
MAN_PAGES.progress = page('progress', 6, 'Terminal Quest: show XP, rank and achievements',
  'progress', 'Show your XP, rank, current level and unlocked achievements.', [], []);
MAN_PAGES.skills = page('skills', 6, 'Terminal Quest: your proficiency matrix',
  'skills',
  'Show every core command you have learned and how much you have actually\nPRACTISED it: ○ met, ◑ used 1-2 times, ● proficient (3+ times). Proficiency\ncomes from using a command repeatedly in real situations, not from meeting it\nonce — this matrix shows where you truly stand.', [], []);
MAN_PAGES.drill = page('drill', 6, 'Terminal Quest: targeted practice drills',
  'drill [status|quit]',
  'Generate a short, randomized practice task in a fresh /drill sandbox. The\npicker reads your mastery matrix (see: skills) and aims at your WEAKEST\nskills — commands you have met but barely used are up to six times more\nlikely to come up. Drills are graded by the resulting system state, so any\nvalid approach passes. No hints, small XP, repeat as often as you like:\nthis is how "met it once" becomes muscle memory.',
  [['status', 'show the current drill task again'],
   ['quit', 'abandon the current drill (no penalty)']],
  [['drill', 'get a practice task'], ['drill quit', 'bail out of one']]);
MAN_PAGES.exam = page('exam', 6, 'Terminal Quest: OmniCorp certification exam',
  'exam [status|quit]',
  'Take the certification test: a fresh /exam sandbox and a checklist of real\ntasks spanning every core skill, with NO hints and NO command suggestions.\nEach task is graded automatically the moment you get it right. Passing all of\nthem certifies you as an OmniCorp Operator — genuine, demonstrated proficiency.',
  [['status', 'review the task checklist and your progress'],
   ['quit', 'abandon the current attempt']],
  [['exam', 'begin the certification'], ['exam status', 'see remaining tasks']]);
MAN_PAGES.chgrp = page('chgrp', 1, 'change group ownership', 'chgrp [-R] GROUP FILE...',
  'Change the group of each FILE. You may set it to any group you belong to on\nfiles you own; root may set any group.', [['-R', 'recurse into directories']],
  [['chgrp devteam /srv/shared', 'hand the directory to the devteam group']]);
MAN_PAGES.sl = page('sl', 6, 'correct you if you type sl instead of ls', 'sl',
  'A Steam Locomotive runs across your screen. Punishment for fat fingers.', [], []);
MAN_PAGES.cowsay = page('cowsay', 6, 'configurable speaking cow', 'cowsay [MESSAGE]',
  'A cow says things. Essential infrastructure.', [], []);
MAN_PAGES.fortune = page('fortune', 6, 'print a random, hopefully interesting, adage',
  'fortune', 'Prints wisdom. Quality not guaranteed.', [], []);

module.exports = { MAN_PAGES };
