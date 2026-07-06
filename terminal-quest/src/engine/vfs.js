'use strict';
/*
 * Terminal Quest — virtual filesystem.
 * An in-memory ext4-like tree with paths, permissions, ownership and mtimes.
 * Nothing here ever touches the host filesystem.
 */

const S_DIR = 'dir';
const S_FILE = 'file';
const S_LINK = 'link';

let INODE = 1;

function now() { return Date.now(); }

function mkNode(type, owner, group, mode) {
  return {
    ino: INODE++,
    type,
    owner,
    group,
    mode,
    mtime: now(),
    content: type === S_FILE ? '' : undefined,
    children: type === S_DIR ? {} : undefined,
    target: type === S_LINK ? '' : undefined
  };
}

class FsError extends Error {
  constructor(code, path, msg) {
    super(`${path}: ${msg}`);
    this.code = code;
    this.path = path;
    this.short = msg;
  }
}

class VFS {
  constructor() {
    this.root = mkNode(S_DIR, 'root', 'root', 0o755);
    this.writeHooks = {};   // absolute path -> fn(content, {append, user})
    this.readHooks = {};    // absolute path -> fn() -> content
    this.capacityKB = 1024 * 1024; // fake 1 GB partition, adjustable per level
  }

  // ---- path helpers -------------------------------------------------------

  normalize(p, cwd) {
    if (!p) p = '.';
    let parts;
    if (p.startsWith('/')) parts = [];
    else parts = cwd === '/' ? [] : cwd.split('/').filter(Boolean);
    for (const seg of p.split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    }
    return '/' + parts.join('/');
  }

  parts(abs) { return abs === '/' ? [] : abs.split('/').filter(Boolean); }

  // ---- permissions --------------------------------------------------------

  _bits(node, user) {
    if (user.name === 'root') return 7;
    if (node.owner === user.name) return (node.mode >> 6) & 7;
    if (user.groups && user.groups.includes(node.group)) return (node.mode >> 3) & 7;
    return node.mode & 7;
  }
  canRead(node, user) { return (this._bits(node, user) & 4) !== 0; }
  canWrite(node, user) { return (this._bits(node, user) & 2) !== 0; }
  canExec(node, user) { return (this._bits(node, user) & 1) !== 0; }

  // ---- lookup -------------------------------------------------------------

  lookup(p, cwd, user, opts = {}) {
    const abs = this.normalize(p, cwd);
    const segs = this.parts(abs);
    let node = this.root;
    let parent = null;
    let name = '/';
    for (let i = 0; i < segs.length; i++) {
      if (node.type === S_LINK) node = this._deref(node, user);
      if (!node || node.type !== S_DIR) {
        throw new FsError('ENOTDIR', segs.slice(0, i).join('/') || '/', 'Not a directory');
      }
      if (user && !this.canExec(node, user)) {
        throw new FsError('EACCES', abs, 'Permission denied');
      }
      parent = node;
      name = segs[i];
      node = node.children[name];
      if (!node) {
        if (i === segs.length - 1 && opts.parentOk) {
          return { node: null, parent, name, abs };
        }
        throw new FsError('ENOENT', abs, 'No such file or directory');
      }
    }
    if (opts.follow !== false && node && node.type === S_LINK) {
      node = this._deref(node, user);
      if (!node) throw new FsError('ENOENT', abs, 'No such file or directory');
    }
    return { node, parent, name, abs };
  }

  _deref(link, user) {
    try { return this.lookup(link.target, '/', user).node; }
    catch (e) { return null; }
  }

  exists(p, cwd, user) {
    try { this.lookup(p, cwd, user); return true; } catch (e) { return false; }
  }

  statOrNull(p, cwd, user, follow = true) {
    try { return this.lookup(p, cwd, user, { follow }).node; } catch (e) { return null; }
  }

  // ---- mutations ----------------------------------------------------------

  mkdir(p, cwd, user, mode = 0o755) {
    const r = this.lookup(p, cwd, user, { parentOk: true });
    if (r.node) throw new FsError('EEXIST', r.abs, 'File exists');
    if (!this.canWrite(r.parent, user)) throw new FsError('EACCES', r.abs, 'Permission denied');
    const n = mkNode(S_DIR, user.name, user.groups ? user.groups[0] : user.name, mode);
    r.parent.children[r.name] = n;
    r.parent.mtime = now();
    return n;
  }

  mkdirp(p, cwd = '/', owner = 'root', group = 'root', mode = 0o755) {
    // internal (world-building) helper — bypasses permission checks
    const segs = this.parts(this.normalize(p, cwd));
    let node = this.root;
    for (const s of segs) {
      if (!node.children[s]) node.children[s] = mkNode(S_DIR, owner, group, mode);
      node = node.children[s];
    }
    return node;
  }

  put(p, content, opts = {}) {
    // internal (world-building) helper — bypasses permission checks
    const abs = this.normalize(p, '/');
    const segs = this.parts(abs);
    const name = segs.pop();
    const dir = this.mkdirp('/' + segs.join('/'));
    const n = mkNode(S_FILE, opts.owner || 'root', opts.group || opts.owner || 'root', opts.mode != null ? opts.mode : 0o644);
    n.content = content;
    if (opts.mtime) n.mtime = opts.mtime;
    if (opts.sizeKB) n.fakeSize = opts.sizeKB * 1024; // simulated large files
    dir.children[name] = n;
    return n;
  }

  touch(p, cwd, user) {
    const r = this.lookup(p, cwd, user, { parentOk: true });
    if (r.node) { r.node.mtime = now(); return r.node; }
    if (!this.canWrite(r.parent, user)) throw new FsError('EACCES', r.abs, 'Permission denied');
    const n = mkNode(S_FILE, user.name, user.groups ? user.groups[0] : user.name, 0o644);
    r.parent.children[r.name] = n;
    r.parent.mtime = now();
    return n;
  }

  readFile(p, cwd, user) {
    const r = this.lookup(p, cwd, user);
    if (r.node.type === S_DIR) throw new FsError('EISDIR', r.abs, 'Is a directory');
    if (!this.canRead(r.node, user)) throw new FsError('EACCES', r.abs, 'Permission denied');
    if (this.readHooks[r.abs]) return this.readHooks[r.abs]();
    return r.node.content;
  }

  writeFile(p, content, cwd, user, append = false) {
    const abs = this.normalize(p, cwd);
    if (this.writeHooks[abs]) { this.writeHooks[abs](content, { append, user }); return; }
    const r = this.lookup(p, cwd, user, { parentOk: true });
    if (r.node) {
      if (r.node.type === S_DIR) throw new FsError('EISDIR', r.abs, 'Is a directory');
      if (!this.canWrite(r.node, user)) throw new FsError('EACCES', r.abs, 'Permission denied');
      r.node.content = append ? r.node.content + content : content;
      r.node.mtime = now();
      return r.node;
    }
    if (!this.canWrite(r.parent, user)) throw new FsError('EACCES', r.abs, 'Permission denied');
    const n = mkNode(S_FILE, user.name, user.groups ? user.groups[0] : user.name, 0o644);
    n.content = content;
    r.parent.children[r.name] = n;
    r.parent.mtime = now();
    return n;
  }

  unlink(p, cwd, user, recursive = false) {
    const r = this.lookup(p, cwd, user, { follow: false });
    if (!r.parent) throw new FsError('EPERM', '/', 'Operation not permitted');
    if (r.node.type === S_DIR && !recursive) throw new FsError('EISDIR', r.abs, 'Is a directory');
    if (!this.canWrite(r.parent, user)) throw new FsError('EACCES', r.abs, 'Permission denied');
    delete r.parent.children[r.name];
    r.parent.mtime = now();
    return r;
  }

  rmdir(p, cwd, user) {
    const r = this.lookup(p, cwd, user);
    if (r.node.type !== S_DIR) throw new FsError('ENOTDIR', r.abs, 'Not a directory');
    if (Object.keys(r.node.children).length) throw new FsError('ENOTEMPTY', r.abs, 'Directory not empty');
    if (!this.canWrite(r.parent, user)) throw new FsError('EACCES', r.abs, 'Permission denied');
    delete r.parent.children[r.name];
  }

  copy(src, dst, cwd, user, recursive = false) {
    const s = this.lookup(src, cwd, user);
    if (s.node.type === S_DIR && !recursive) {
      throw new FsError('EISDIR', s.abs, "-r not specified; omitting directory");
    }
    if (!this.canRead(s.node, user)) throw new FsError('EACCES', s.abs, 'Permission denied');
    let d = this.lookup(dst, cwd, user, { parentOk: true });
    let targetName = d.name;
    let targetDir = d.parent;
    let existing = d.node;
    if (d.node && d.node.type === S_DIR) {
      targetDir = d.node; targetName = s.name;
      existing = d.node.children[targetName];
    }
    // Overwriting an existing regular file writes into that file (needs write
    // on the FILE), rather than replacing the directory entry (needs write on
    // the DIR) — matching real cp semantics.
    if (existing && existing.type === S_FILE && s.node.type === S_FILE) {
      if (!this.canWrite(existing, user)) throw new FsError('EACCES', d.abs, 'Permission denied');
      existing.content = s.node.content;
      if (s.node.fakeSize !== undefined) existing.fakeSize = s.node.fakeSize;
      else delete existing.fakeSize;
      existing.mtime = now();
      return;
    }
    if (!this.canWrite(targetDir, user)) throw new FsError('EACCES', d.abs, 'Permission denied');
    targetDir.children[targetName] = this._clone(s.node, user);
    targetDir.mtime = now();
  }

  _clone(node, user) {
    const n = mkNode(node.type, user.name, user.groups ? user.groups[0] : user.name, node.mode);
    if (node.type === S_FILE) n.content = node.content;
    if (node.type === S_LINK) n.target = node.target;
    if (node.type === S_DIR) {
      for (const [k, v] of Object.entries(node.children)) n.children[k] = this._clone(v, user);
    }
    return n;
  }

  move(src, dst, cwd, user) {
    const s = this.lookup(src, cwd, user, { follow: false });
    let d = this.lookup(dst, cwd, user, { parentOk: true });
    let targetName = d.name;
    let targetDir = d.parent;
    if (d.node && d.node.type === S_DIR) { targetDir = d.node; targetName = s.name; }
    if (!this.canWrite(targetDir, user) || !this.canWrite(s.parent, user)) {
      throw new FsError('EACCES', d.abs, 'Permission denied');
    }
    targetDir.children[targetName] = s.node;
    delete s.parent.children[s.name];
    s.node.mtime = now();
  }

  chmod(p, mode, cwd, user) {
    const r = this.lookup(p, cwd, user);
    if (user.name !== 'root' && r.node.owner !== user.name) {
      throw new FsError('EPERM', r.abs, 'Operation not permitted');
    }
    r.node.mode = mode;
  }

  chown(p, owner, group, cwd, user, recursive = false) {
    const r = this.lookup(p, cwd, user);
    if (user.name !== 'root') {
      // Non-root may only change the GROUP (not the owner), only on files they
      // own, and only to a group they are a member of — real Linux semantics.
      if (owner) throw new FsError('EPERM', r.abs, 'Operation not permitted');
      if (r.node.owner !== user.name) throw new FsError('EPERM', r.abs, 'Operation not permitted');
      if (group && !(user.groups || []).includes(group)) {
        throw new FsError('EPERM', r.abs, 'Operation not permitted');
      }
    }
    const apply = (n) => {
      if (owner) n.owner = owner;
      if (group) n.group = group;
      if (recursive && n.type === S_DIR) Object.values(n.children).forEach(apply);
    };
    apply(r.node);
  }

  list(p, cwd, user) {
    const r = this.lookup(p, cwd, user);
    if (r.node.type !== S_DIR) return [{ name: r.name, node: r.node }];
    if (!this.canRead(r.node, user)) throw new FsError('EACCES', r.abs, 'Permission denied');
    return Object.entries(r.node.children)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, node]) => ({ name, node }));
  }

  // ---- glob ---------------------------------------------------------------

  static globToRegExp(pat) {
    let re = '^';
    for (const ch of pat) {
      if (ch === '*') re += '[^/]*';
      else if (ch === '?') re += '[^/]';
      else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(re + '$');
  }

  glob(pattern, cwd, user) {
    // Expand a single glob pattern into matching paths (like the shell does).
    const abs = pattern.startsWith('/');
    const segments = pattern.split('/').filter(Boolean);
    let results = [abs ? '/' : cwd];
    let rels = [abs ? '' : ''];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const next = [];
      const nextRel = [];
      for (let j = 0; j < results.length; j++) {
        const base = results[j];
        const rel = rels[j];
        if (!/[*?]/.test(seg)) {
          const cand = this.normalize(base + '/' + seg, '/');
          if (this.exists(cand, '/', user)) {
            next.push(cand); nextRel.push(rel ? rel + '/' + seg : seg);
          }
          continue;
        }
        const re = VFS.globToRegExp(seg);
        let entries;
        try { entries = this.list(base, '/', user); } catch (e) { continue; }
        for (const { name } of entries) {
          if (name.startsWith('.') && !seg.startsWith('.')) continue;
          if (re.test(name)) {
            next.push(this.normalize(base + '/' + name, '/'));
            nextRel.push(rel ? rel + '/' + name : name);
          }
        }
      }
      results = next; rels = nextRel;
    }
    const out = abs ? results : rels;
    return out.sort();
  }

  // ---- sizes --------------------------------------------------------------

  sizeOf(node) {
    if (node.type === S_FILE) return node.fakeSize !== undefined ? node.fakeSize : node.content.length;
    if (node.type === S_DIR) {
      let t = 4096;
      for (const c of Object.values(node.children)) t += this.sizeOf(c);
      return t;
    }
    return 0;
  }

  usedKB() { return Math.ceil(this.sizeOf(this.root) / 1024); }

  walk(p, cwd, user, fn) {
    const r = this.lookup(p, cwd, user);
    const visit = (abs, name, node, depth) => {
      fn(abs, name, node, depth);
      if (node.type === S_DIR) {
        for (const [k, v] of Object.entries(node.children).sort((a, b) => a[0].localeCompare(b[0]))) {
          visit(abs === '/' ? '/' + k : abs + '/' + k, k, v, depth + 1);
        }
      }
    };
    visit(r.abs, r.name, r.node, 0);
  }
}

module.exports = { VFS, FsError, S_DIR, S_FILE, S_LINK };
