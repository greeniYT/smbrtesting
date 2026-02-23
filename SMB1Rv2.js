(function () {
  'use strict';

  const WASM_PARTS = [
    'https://cdn.jsdelivr.net/gh/greeniYT/smbrtesting@main/SMB1R.wasm.part1',
    'https://cdn.jsdelivr.net/gh/greeniYT/smbrtesting@main/SMB1R.wasm.part2',
  ];

  const PCK_PARTS = [
    'https://cdn.jsdelivr.net/gh/greeniYT/smbrtesting@main/SMB1R.pck.part1',
    'https://cdn.jsdelivr.net/gh/greeniYT/smbrtesting@main/SMB1R.pck.part2',
    'https://cdn.jsdelivr.net/gh/greeniYT/smbrtesting@main/SMB1R.pck.part3',
  ];

  function fetchAndConcatenate(urls, onProgress) {
    const loaded = new Array(urls.length).fill(0);
    const totals = new Array(urls.length).fill(0);

    function reportProgress() {
      if (typeof onProgress === 'function') {
        onProgress(
          loaded.reduce((a, b) => a + b, 0),
          totals.reduce((a, b) => a + b, 0)
        );
      }
    }

    const promises = urls.map((url, idx) =>
      fetch(url).then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);

        const contentLength = res.headers.get('Content-Length');
        if (contentLength) totals[idx] = parseInt(contentLength, 10);

        const reader = res.body.getReader();
        const chunks = [];

        function pump() {
          return reader.read().then(({ done, value }) => {
            if (done) return;
            chunks.push(value);
            loaded[idx] += value.byteLength;
            reportProgress();
            return pump();
          });
        }

        return pump().then(() => {
          const totalSize = chunks.reduce((n, c) => n + c.byteLength, 0);
          const merged = new Uint8Array(totalSize);
          let offset = 0;
          for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.byteLength;
          }
          return merged;
        });
      })
    );

    return Promise.all(promises).then((parts) => {
      const totalSize = parts.reduce((n, p) => n + p.byteLength, 0);
      const result = new Uint8Array(totalSize);
      let offset = 0;
      for (const part of parts) {
        result.set(part, offset);
        offset += part.byteLength;
      }
      return result.buffer;
    });
  }

  const _originalLoad = Engine.load.bind(Engine);

  Engine.load = function (basePath, size) {
    const wasmReady = fetchAndConcatenate(WASM_PARTS).then((buffer) => {
      return new Response(buffer, {
        headers: { 'Content-Type': 'application/wasm' },
      });
    });

    const _originalInit = Engine.prototype.init;
    Engine.prototype.init = function (bp) {
      const me = this;
      const _originalGetModuleConfig = me.config.getModuleConfig.bind(me.config);

      me.config.getModuleConfig = function (loadPath, _ignoredResponse) {
        return wasmReady.then((wasmResponse) => {
          return _originalGetModuleConfig(loadPath, wasmResponse);
        });
      };

      Engine.prototype.init = _originalInit;
      return _originalInit.call(me, bp);
    };

    return _originalLoad(basePath, 0);
  };

  const _originalPreloadFile = Engine.prototype.preloadFile;

  Engine.prototype.preloadFile = function (file, path) {
    if (typeof file === 'string' && file.endsWith('.pck')) {
      const me = this;
      return fetchAndConcatenate(PCK_PARTS).then((buffer) => {
        return _originalPreloadFile.call(me, buffer, path || file);
      });
    }
    return _originalPreloadFile.apply(this, arguments);
  };

}());
