/* Cutpeak boot loader.
 *
 * The deployed program is one file: system.sys, which is
 * [program files -> zip -> base64]. Keeping it that way means a deploy uploads
 * a handful of files instead of one per chunk, and the whole program arrives in
 * a single request.
 *
 * Unpacking costs real time, so the expanded files are kept in localStorage
 * under the build stamp and every later visit reads them from there. When the
 * quota refuses them the page still starts; it just unpacks again next time,
 * and the service worker keeps system.sys itself out of the network.
 *
 * This file is plain classic JavaScript on purpose: it is the one thing that
 * loads before the program does.
 */
(function () {
  'use strict';
  var tag = document.querySelector('script[data-cutpeak-build]');
  if (!tag) return;
  var build = tag.getAttribute('data-cutpeak-build');
  var entry = tag.getAttribute('data-cutpeak-entry');
  var style = tag.getAttribute('data-cutpeak-style');
  var PREFIX = 'cutpeak:system:';

  function fail(message) {
    var box = document.createElement('div');
    box.setAttribute(
      'style',
      'position:fixed;inset:0;display:grid;place-items:center;padding:24px;' +
        'font:15px/1.7 system-ui,sans-serif;color:#e7e7ea;background:#101011;text-align:center',
    );
    box.textContent = message;
    document.body.appendChild(box);
  }

  function decodeBase64(text) {
    var binary = atob(text.replace(/\s+/g, ''));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /* Minimal ZIP central-directory reader. The archive is written by
   * native/zip.c, so only the two methods it emits need handling. */
  function readArchive(bytes) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var eocd = -1;
    var lowest = Math.max(0, bytes.length - 65557);
    for (var at = bytes.length - 22; at >= lowest; at--)
      if (view.getUint32(at, true) === 0x06054b50) {
        eocd = at;
        break;
      }
    if (eocd < 0) throw Error('system.sys の末尾を読み取れません');
    var count = view.getUint16(eocd + 10, true);
    var cursor = view.getUint32(eocd + 16, true);
    var decoder = new TextDecoder();
    var entries = [];
    for (var index = 0; index < count; index++) {
      if (view.getUint32(cursor, true) !== 0x02014b50)
        throw Error('system.sys の目録が壊れています');
      var method = view.getUint16(cursor + 10, true);
      var compressedSize = view.getUint32(cursor + 20, true);
      var nameLength = view.getUint16(cursor + 28, true);
      var extraLength = view.getUint16(cursor + 30, true);
      var commentLength = view.getUint16(cursor + 32, true);
      var localOffset = view.getUint32(cursor + 42, true);
      var name = decoder.decode(
        bytes.subarray(cursor + 46, cursor + 46 + nameLength),
      );
      var dataOffset =
        localOffset +
        30 +
        view.getUint16(localOffset + 26, true) +
        view.getUint16(localOffset + 28, true);
      entries.push({
        name: name,
        method: method,
        data: bytes.subarray(dataOffset, dataOffset + compressedSize),
      });
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }

  function inflate(entry) {
    if (entry.method === 0) return Promise.resolve(entry.data);
    if (typeof DecompressionStream === 'undefined')
      return Promise.reject(
        Error('このブラウザーでは system.sys を展開できません'),
      );
    return new Response(
      new Blob([entry.data]).stream().pipeThrough(
        new DecompressionStream('deflate-raw'),
      ),
    )
      .arrayBuffer()
      .then(function (buffer) {
        return new Uint8Array(buffer);
      });
  }

  function cached() {
    try {
      if (localStorage.getItem(PREFIX + 'build') !== build) return null;
      var names = JSON.parse(localStorage.getItem(PREFIX + 'manifest') || '[]');
      var files = {};
      for (var i = 0; i < names.length; i++) {
        var value = localStorage.getItem(PREFIX + 'file:' + names[i]);
        if (value === null) return null;
        files[names[i]] = value;
      }
      return names.length ? files : null;
    } catch (error) {
      return null;
    }
  }

  function remember(files) {
    var names = Object.keys(files);
    try {
      localStorage.removeItem(PREFIX + 'build');
      for (var i = 0; i < names.length; i++)
        localStorage.setItem(PREFIX + 'file:' + names[i], files[names[i]]);
      localStorage.setItem(PREFIX + 'manifest', JSON.stringify(names));
      localStorage.setItem(PREFIX + 'build', build);
    } catch (error) {
      /* A full or disabled store only costs the unpack on the next visit. */
      try {
        for (var k = localStorage.length - 1; k >= 0; k--) {
          var key = localStorage.key(k);
          if (key && key.indexOf(PREFIX) === 0) localStorage.removeItem(key);
        }
      } catch (ignored) {}
      console.info('system.sys をブラウザーに保存できませんでした', error);
    }
  }

  function unpack() {
    return fetch('system.sys', { cache: 'no-cache' })
      .then(function (response) {
        if (!response.ok) throw Error('system.sys を読み込めません');
        return response.text();
      })
      .then(function (text) {
        var entries = readArchive(decodeBase64(text));
        return Promise.all(entries.map(inflate)).then(function (contents) {
          var decoder = new TextDecoder();
          var files = {};
          for (var i = 0; i < entries.length; i++)
            files[entries[i].name] = decoder.decode(contents[i]);
          return files;
        });
      });
  }

  function start(files) {
    if (style && files[style]) {
      var sheet = document.createElement('style');
      sheet.textContent = files[style];
      document.head.appendChild(sheet);
    }
    if (!files[entry]) throw Error('system.sys に ' + entry + ' がありません');
    var url = URL.createObjectURL(
      new Blob([files[entry]], { type: 'text/javascript' }),
    );
    return import(url);
  }

  var ready = cached();
  var work = ready
    ? Promise.resolve(ready)
    : unpack().then(function (files) {
        remember(files);
        return files;
      });
  work
    .then(start)
    .catch(function (error) {
      console.error(error);
      fail(
        'Cutpeak を起動できませんでした: ' +
          (error && error.message ? error.message : error) +
          '\n再読み込みしてください。',
      );
    });
})();
