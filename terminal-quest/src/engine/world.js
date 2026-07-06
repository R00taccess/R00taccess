'use strict';
/*
 * Terminal Quest — base world builder.
 * Creates the OmniCorp server filesystem, users, base processes and network.
 * Level setups then layer their own content on top.
 */

function buildBaseWorld(game) {
  const vfs = game.vfs;
  const DAY = 86400000;
  const old = (days) => Date.now() - days * DAY;

  // --- directory skeleton ---
  vfs.mkdirp('/home/player', '/', 'player', 'player', 0o755);
  vfs.mkdirp('/root', '/', 'root', 'root', 0o700);
  vfs.mkdirp('/tmp', '/', 'root', 'root', 0o777);
  vfs.mkdirp('/etc');
  vfs.mkdirp('/var/log');
  vfs.mkdirp('/var/mail');
  vfs.mkdirp('/var/backups');
  vfs.mkdirp('/var/data');
  vfs.mkdirp('/usr/bin');
  vfs.mkdirp('/usr/share/doc');
  vfs.mkdirp('/opt/scripts');
  vfs.mkdirp('/srv');
  vfs.mkdirp('/dev');
  vfs.mkdirp('/data');

  // --- /etc ---
  vfs.put('/etc/hostname', 'omnicorp\n');
  vfs.put('/etc/motd',
    '   ___  __  __ _  _ ___ ___ ___  ___ ___\n' +
    '  / _ \\|  \\/  | \\| |_ _/ __/ _ \\| _ \\ _ \\\n' +
    ' | (_) | |\\/| | .` || | (_| (_) |   /  _/\n' +
    '  \\___/|_|  |_|_|\\_|___\\___\\___/|_|_\\_|\n' +
    '\n  Property of OmniCorp. All sessions are monitored.\n' +
    '  Unauthorized access will be reported to The Director.\n');
  vfs.put('/etc/passwd',
    'root:x:0:0:root:/root:/bin/bash\n' +
    'alex:x:1001:1001:Alex Chen,Senior Admin:/home/alex:/bin/bash\n' +
    'player:x:1000:1000:Junior Sysadmin:/home/player:/bin/bash\n' +
    'svc-deploy:x:998:998:Deploy Service:/var/lib/deploy:/usr/sbin/nologin\n' +
    'www:x:33:33:www-data:/srv/www:/usr/sbin/nologin\n');
  vfs.put('/etc/hosts',
    '127.0.0.1\tlocalhost\n10.13.37.10\tomnicorp\n10.13.37.20\twebserver01\n' +
    '10.13.37.30\tbackup01\n10.13.37.40\tapi.omnicorp.local\n');
  vfs.put('/etc/omnid.conf',
    '# omnid — OmniCorp master control daemon\nlisten=0.0.0.0:9000\nworkers=4\nsafety_interlocks=on\n');

  // --- home ---
  vfs.put('/home/player/.bashrc', '# ~/.bashrc — junior sysadmin defaults\nexport PS1="\\u@\\h:\\w\\$ "\nalias ll="ls -l"\n', { owner: 'player' });
  vfs.put('/home/player/welcome.txt',
    'Welcome to OmniCorp, recruit.\n\nThis terminal is your only interface to the company mainframe.\nType `help` for the survival basics, `mail` to read your messages,\nand `man <command>` whenever a command confuses you.\n\n— IT Onboarding (automated, do not reply, the mail server is haunted)\n',
    { owner: 'player' });

  vfs.mkdirp('/home/alex', '/', 'alex', 'alex', 0o750);
  vfs.put('/home/alex/.plan', 'Fix everything. Sleep eventually.\n', { owner: 'alex', mode: 0o644 });

  // --- logs ---
  vfs.put('/var/log/syslog',
    ['Jan  5 08:00:01 omnicorp systemd[1]: Startup finished in 4.2s.',
     'Jan  5 08:00:02 omnicorp omnid[812]: safety interlocks engaged',
     'Jan  5 08:12:11 omnicorp sshd[901]: Accepted publickey for alex from 10.13.37.5',
     'Jan  5 09:00:00 omnicorp CRON[1122]: (root) CMD (/opt/scripts/heartbeat.sh)',
     'Jan  5 09:30:15 omnicorp omnid[812]: routine self-check: OK'].join('\n') + '\n',
    { mtime: old(1) });
  vfs.put('/var/log/auth.log',
    'Jan  5 08:12:11 omnicorp sshd[901]: Accepted publickey for alex from 10.13.37.5 port 51022\n',
    { mtime: old(1) });

  // --- misc flavour ---
  vfs.put('/usr/share/doc/HANDBOOK.txt',
    'OMNICORP SYSADMIN HANDBOOK (excerpt)\n' +
    'Rule 1: Read the logs.\nRule 2: Make a backup before you change anything.\n' +
    'Rule 3: If Rule 2 was skipped, consult /var/backups and pray.\n' +
    'Rule 4: The Director is always watching. Wave occasionally.\n');
  vfs.put('/opt/scripts/heartbeat.sh', '#!/bin/bash\n# pings the mothership so it knows we are alive\necho beep\n', { mode: 0o755 });
  vfs.put('/var/backups/README.txt', 'Nightly snapshots of critical paths land here. Guard them well.\n');

  // --- /dev special files ---
  vfs.put('/dev/null', '', { mode: 0o666 });
  vfs.put('/dev/exit', '', { mode: 0o666 });
  vfs.writeHooks['/dev/null'] = () => {};
  vfs.readHooks['/dev/null'] = () => '';
  vfs.writeHooks['/dev/exit'] = (content) => game.trySubmit(String(content).trim(), null);
  vfs.readHooks['/dev/exit'] = () => 'This is the exit gate. Write your flag to it:  echo THE_FLAG > /dev/exit\n';

  // --- processes ---
  game.procs = [
    { pid: 1, user: 'root', cpu: 0.0, mem: 0.1, time: '00:00:04', cmd: '/sbin/init', critical: true },
    { pid: 812, user: 'root', cpu: 0.3, mem: 1.2, time: '00:01:12', cmd: '/usr/sbin/omnid --safety=on', critical: true },
    { pid: 901, user: 'root', cpu: 0.0, mem: 0.4, time: '00:00:01', cmd: '/usr/sbin/sshd -D' },
    { pid: 1122, user: 'root', cpu: 0.0, mem: 0.2, time: '00:00:00', cmd: '/usr/sbin/cron' },
    { pid: 1400, user: 'www', cpu: 1.1, mem: 2.5, time: '00:03:41', cmd: 'nginx: worker process' },
    { pid: 1401, user: 'player', cpu: 0.1, mem: 0.6, time: '00:00:00', cmd: '-bash' }
  ];

  // --- network ---
  game.network = {
    eth0: { up: true, ip: '10.13.37.10' },
    hosts: {
      localhost: {
        ip: '127.0.0.1', up: true,
        ports: { 80: { responding: true, body: (p) => game.localhostHttp(p) } }
      },
      omnicorp: { ip: '10.13.37.10', up: true, ports: { 22: { responding: true }, 80: { responding: true, body: (p) => game.localhostHttp(p) } } },
      webserver01: {
        ip: '10.13.37.20', up: true,
        ports: { 22: { responding: true }, 80: { responding: true, body: 'OmniCorp public site — all systems nominal\n' } }
      },
      backup01: {
        ip: '10.13.37.30', up: true,
        motd: 'backup01 — offsite vault node. Tread lightly.\n',
        ports: { 22: { responding: true } },
        files: { '/etc/motd': 'backup01 — offsite vault node.\n' }
      },
      'api.omnicorp.local': {
        ip: '10.13.37.40', up: true,
        ports: { 22: { responding: true }, 80: { responding: true, body: '{"status":"ok"}\n' } }
      }
    },
    connections: [
      { local: '0.0.0.0:22', remote: '0.0.0.0:*', state: 'LISTEN', pid: 901, prog: 'sshd' },
      { local: '0.0.0.0:80', remote: '0.0.0.0:*', state: 'LISTEN', pid: 1400, prog: 'nginx' },
      { local: '10.13.37.10:22', remote: '10.13.37.5:51022', state: 'ESTABLISHED', pid: 901, prog: 'sshd' }
    ]
  };

  // --- sessions / login history ---
  game.sessions = [
    { user: 'player', tty: 'pts/0', time: '2026-01-05 09:00', from: 'console' }
  ];
  game.lastLog = [
    { user: 'player', tty: 'pts/0', from: 'console', time: 'Mon Jan  5 09:00   still logged in' },
    { user: 'alex', tty: 'pts/1', from: '10.13.37.5', time: 'Mon Jan  5 08:12 - 08:55  (00:43)' },
    { user: 'root', tty: 'tty1', from: '', time: 'Sun Jan  4 23:14 - 23:20  (00:06)' }
  ];
}

module.exports = { buildBaseWorld };
