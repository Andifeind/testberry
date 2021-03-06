/*global performance:false */
'use strict';

let Testberry = function() {

};

Testberry.__definitions = {}

// eslint-disable-next-line
let log = console.log;
let profilerStack = [];

Testberry.getNanoTime = typeof process === 'object' ? process.hrtime : function(nt) {
  if (nt) {
    let t2 = performance.now();
    return t2 * 1e6 - nt  * 1e6;
  }

  return performance.now();
}

Testberry.time = function() {
  return {
    nanotime: Testberry.getNanoTime(),
    stop: function() {
      let t = Testberry.getNanoTime(this.nanotime);
      if (Array.isArray(t)) {
        t = t[0] * 1e9 + t[1];
      }
      return Testberry.humanizeTime(t);
    }
  }
}

Testberry.humanizeTime = function(nt) {
  if (nt < 1e3) {
    return nt + 'ns';
  }

  if (nt < 1e6) {
    return Math.round(nt / 1e3) + 'µs';
  }

  if (nt < 1e9) {
    return Math.round(nt / 1e6) + 'ms';
  }

  return Math.round(nt / 1e9) + 's';
};

Testberry.testSkip = function(title, fn) {
  let time = Testberry.time();
  let passed = false;
  let error;

  try {
    fn();
    passed = true;
  } catch(err) {
    error = err.stack || err;
  }

  let runtime = time.stop();
  if (passed) {
    log(' ⏱ Messurement of ' + title + ' took ' + runtime);
  }
  else {
    log(' ⏱ Messurement of ' + title + ' failed after ' + runtime);
    log('Error: ' + error);
  }
}

Testberry.test = function(title, fn) {
  let passed = false;
  let error;
  let time;
  let runtime;

  let testDone = function() {
    runtime = time.stop();
    if (passed) {
      log(' ⏱ Messurement of ' + title + ' took ' + runtime);
    }
    else {
      log(' ⏱ Messurement of ' + title + ' failed after ' + runtime);
      log('Error: ' + error);
    }
  };

  try {
    time = Testberry.time();
    passed = true;
    if (fn.length === 1) return fn(testDone);
    testDone();
  } catch(err) {
    error = err.stack || err;
    testDone();
  }
}

Testberry.testPerf = function(title, duration, fn) {
  let count = 0;
  let passed = false;
  let error;

  try {
    count = fn(count);
    passed = true;
  } catch(err) {
    error = err.stack || err;
  }

  if (passed) {
    log('⏱ ' + title + ' ran ' + count + ' times within ' + Testberry.humanizeTime(duration * 1e6));
  }
  else {
    log('⏱ ' + title + ' failed after ' + count + ' iterations.');
    log('Error: ' + error);
  }
};

Testberry.bench = function(title, loops, fn) {
  if (typeof loops === 'function') {
    fn = loops;
    loops = 1000;
  }

  Testberry.test(title + ' benchmark with ' + loops + ' loops', function() {
    for (let i = 0; i < loops; i++) {
      fn();
    }
  });
};

Testberry.perf = function(title, duration, fn) {
  if (typeof duration === 'function') {
    fn = duration;
    duration = 1000;
  }

  Testberry.testPerf(title, duration, function(count) {
    let run = true;
    let time = Date.now();

    while (run) {
      fn();
      if (Date.now() - time >= duration) {
        run = false;
      }
      count += 1;
    }

    return count;
  });
};

Testberry.request = function(title, loops, fn) {

};

Testberry.profile = function(fn, args) {
  args = Array.prototype.slice.call(arguments, 1);
  let funcName = fn.name || 'anonymous function';

  let timer;
  let returnValue;
  let callTime;
  let thrownError = null;
  let type = 'func';

  let lastArg = args[args.length - 1];
  let cbStack = [];

  if (typeof lastArg === 'function') {
    type = 'cb-func';
    let cbFunc = args.pop();
    let thisValue = this;

    args.push(function() {
      let callTime = timer.stop();
      let callArgs = Array.prototype.slice.call(arguments);
      cbStack.push({
        callTime: callTime,
        callArgs: callArgs
      });

      cbFunc.apply(thisValue, callArgs);
    });
  }

  try {
    timer = Testberry.time();
    returnValue = fn.apply(this, args);
    callTime = timer.stop();
  } catch (err) {
    callTime = timer.stop();
    thrownError = err;
  }

  let promiseCalls = [];
  let profiling = {
    type: type,
    name: funcName,
    args: args,
    callTime: callTime,
    returnValue: returnValue
  };

  if (returnValue && typeof returnValue.then === 'function') {
    let thenFn = returnValue.then;
    let catchFn = returnValue.catch;

    let isReady;
    returnValue.then(data => {
      promiseCalls.push({
        method: 'then',
        args: [data],
        callTime: timer.stop(),
        intermediate: true
      });

      isReady = true;
    });

    if (!isReady) {
      returnValue.then = function(onFullfilled, onRejected) {
        let args = Array.prototype.slice.call(arguments);
        promiseCalls.push({
          method: 'then',
          args: args,
          callTime: timer.stop(),
          foo: 1
        });

        return thenFn.apply(this, args);
      }

      returnValue.catch = function(onRejected) {
        let args = Array.prototype.slice.call(arguments);
        promiseCalls.push({
          method: 'catch',
          args: args,
          callTime: timer.stop(),
          foo: 1
        });

        return catchFn.apply(this, args);
      }
    }

    profiling.promiseCalls = promiseCalls;
    // returnValue.then()
  }

  if (thrownError) {
    profiling.thrownError = thrownError;
  }

  if (type === 'cb-func') {
    profiling.callbackCalls = cbStack;
  }

  profilerStack.push(profiling);

  if (thrownError) {
    throw thrownError;
  }

  return returnValue;
};

Testberry.getLastProfiling = function() {
  return profilerStack[profilerStack.length - 1];
}

Testberry.define = function(name, fn) {
  if (this.__definitions[name]) {
    throw new Error('Method ' + name + ' already defined');
  }

  this.__definitions[name] = fn
}

Testberry.run = function(funcs, ctx) {
  function next(c) {
    const fnName = funcs.shift()
    if (!fnName) {
      return c
    }

    const fn = Testberry.__definitions[fnName]
    if (!fn) {
      throw new Error('No function defined with name: ' + fnName)
    }

    const p = fn(c)
    if (typeof p.then === 'function' && p.catch === 'function') {
      p.then((res) => {
        next(res)
      }).catch((err) => {
        throw new Error(err)
      })
    } else {
      next(p)
      return p
    }
  }

  return next(ctx || {})
}

if (typeof module === 'undefined') {
  // eslint-disable-next-line
  window.testberry = Testberry;
}
else {
  module.exports = Testberry;
}
