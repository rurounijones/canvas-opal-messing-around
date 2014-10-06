(function(undefined) {
  // The Opal object that is exposed globally
  var Opal = this.Opal = {};

  // The actual class for BasicObject
  var RubyBasicObject;

  // The actual Object class
  var RubyObject;

  // The actual Module class
  var RubyModule;

  // The actual Class class
  var RubyClass;

  // Constructor for instances of BasicObject
  function BasicObject(){}

  // Constructor for instances of Object
  function Object(){}

  // Constructor for instances of Class
  function Class(){}

  // Constructor for instances of Module
  function Module(){}

  // Constructor for instances of NilClass (nil)
  function NilClass(){}

  // All bridged classes - keep track to donate methods from Object
  var bridged_classes = [];

  // TopScope is used for inheriting constants from the top scope
  var TopScope = function(){};

  // Opal just acts as the top scope
  TopScope.prototype = Opal;

  // To inherit scopes
  Opal.constructor  = TopScope;

  Opal.constants = [];

  // This is a useful reference to global object inside ruby files
  Opal.global = this;

  // Minify common function calls
  var $hasOwn = Opal.hasOwnProperty;
  var $slice  = Opal.slice = Array.prototype.slice;

  // Generates unique id for every ruby object
  var unique_id = 0;

  // Return next unique id
  Opal.uid = function() {
    return unique_id++;
  };

  // Table holds all class variables
  Opal.cvars = {};

  // Globals table
  Opal.gvars = {};

  /*
   * Create a new constants scope for the given class with the given
   * base. Constants are looked up through their parents, so the base
   * scope will be the outer scope of the new klass.
   */
  function create_scope(base, klass, id) {
    var const_alloc   = function() {};
    var const_scope   = const_alloc.prototype = new base.constructor();
    klass._scope      = const_scope;
    const_scope.base  = klass;
    klass._base_module = base.base;
    const_scope.constructor = const_alloc;
    const_scope.constants = [];

    if (id) {
      klass._orig_scope = base;
      base[id] = base.constructor[id] = klass;
      base.constants.push(id);
    }
  }

  Opal.create_scope = create_scope;

  /*
   * A `class Foo; end` expression in ruby is compiled to call this runtime
   * method which either returns an existing class of the given name, or creates
   * a new class in the given `base` scope.
   *
   * If a constant with the given name exists, then we check to make sure that
   * it is a class and also that the superclasses match. If either of these
   * fail, then we raise a `TypeError`. Note, superklass may be null if one was
   * not specified in the ruby code.
   *
   * We pass a constructor to this method of the form `function ClassName() {}`
   * simply so that classes show up with nicely formatted names inside debuggers
   * in the web browser (or node/sprockets).
   *
   * The `base` is the current `self` value where the class is being created
   * from. We use this to get the scope for where the class should be created.
   * If `base` is an object (not a class/module), we simple get its class and
   * use that as the base instead.
   *
   * @param [Object] base where the class is being created
   * @param [Class] superklass superclass of the new class (may be null)
   * @param [String] id the name of the class to be created
   * @param [Function] constructor function to use as constructor
   * @return [Class] new or existing ruby class
   */
  Opal.klass = function(base, superklass, id, constructor) {

    // If base is an object, use its class
    if (!base._isClass) {
      base = base._klass;
    }

    // Not specifying a superclass means we can assume it to be Object
    if (superklass === null) {
      superklass = RubyObject;
    }

    var klass = base._scope[id];

    // If a constant exists in the scope, then we must use that
    if ($hasOwn.call(base._scope, id) && klass._orig_scope === base._scope) {

      // Make sure the existing constant is a class, or raise error
      if (!klass._isClass) {
        throw Opal.TypeError.$new(id + " is not a class");
      }

      // Make sure existing class has same superclass
      if (superklass !== klass._super && superklass !== RubyObject) {
        throw Opal.TypeError.$new("superclass mismatch for class " + id);
      }
    }
    else if (typeof(superklass) === 'function') {
      // passed native constructor as superklass, so bridge it as ruby class
      return bridge_class(id, superklass);
    }
    else {
      // if class doesnt exist, create a new one with given superclass
      klass = boot_class(superklass, constructor);

      // name class using base (e.g. Foo or Foo::Baz)
      klass._name = id;

      // every class gets its own constant scope, inherited from current scope
      create_scope(base._scope, klass, id);

      // Name new class directly onto current scope (Opal.Foo.Baz = klass)
      base[id] = base._scope[id] = klass;

      // Copy all parent constants to child, unless parent is Object
      if (superklass !== RubyObject && superklass !== RubyBasicObject) {
        Opal.donate_constants(superklass, klass);
      }

      // call .inherited() hook with new class on the superclass
      if (superklass.$inherited) {
        superklass.$inherited(klass);
      }
    }

    return klass;
  };

  // Create generic class with given superclass.
  var boot_class = Opal.boot = function(superklass, constructor) {
    // instances
    var ctor = function() {};
        ctor.prototype = superklass._proto;

    constructor.prototype = new ctor();

    constructor.prototype.constructor = constructor;

    return boot_class_meta(superklass, constructor);
  };

  // class itself
  function boot_class_meta(superklass, constructor) {
    var mtor = function() {};
    mtor.prototype = superklass.constructor.prototype;

    function OpalClass() {};
    OpalClass.prototype = new mtor();

    var klass = new OpalClass();

    klass._id         = unique_id++;
    klass._alloc      = constructor;
    klass._isClass    = true;
    klass.constructor = OpalClass;
    klass._super      = superklass;
    klass._methods    = [];
    klass.__inc__     = [];
    klass.__parent    = superklass;
    klass._proto      = constructor.prototype;

    constructor.prototype._klass = klass;

    return klass;
  }

  // Define new module (or return existing module)
  Opal.module = function(base, id) {
    var module;

    if (!base._isClass) {
      base = base._klass;
    }

    if ($hasOwn.call(base._scope, id)) {
      module = base._scope[id];

      if (!module.__mod__ && module !== RubyObject) {
        throw Opal.TypeError.$new(id + " is not a module")
      }
    }
    else {
      module = boot_module()
      module._name = id;

      create_scope(base._scope, module, id);

      // Name new module directly onto current scope (Opal.Foo.Baz = module)
      base[id] = base._scope[id] = module;
    }

    return module;
  };

  /*
   * Internal function to create a new module instance. This simply sets up
   * the prototype hierarchy and method tables.
   */
  function boot_module() {
    var mtor = function() {};
    mtor.prototype = RubyModule.constructor.prototype;

    function OpalModule() {};
    OpalModule.prototype = new mtor();

    var module = new OpalModule();

    module._id         = unique_id++;
    module._isClass    = true;
    module.constructor = OpalModule;
    module._super      = RubyModule;
    module._methods    = [];
    module.__inc__     = [];
    module.__parent    = RubyModule;
    module._proto      = {};
    module.__mod__     = true;
    module.__dep__     = [];

    return module;
  }

  // Boot a base class (makes instances).
  var boot_defclass = function(id, constructor, superklass) {
    if (superklass) {
      var ctor           = function() {};
          ctor.prototype = superklass.prototype;

      constructor.prototype = new ctor();
    }

    constructor.prototype.constructor = constructor;

    return constructor;
  };

  // Boot the actual (meta?) classes of core classes
  var boot_makemeta = function(id, constructor, superklass) {

    var mtor = function() {};
    mtor.prototype  = superklass.prototype;

    function OpalClass() {};
    OpalClass.prototype = new mtor();

    var klass = new OpalClass();

    klass._id         = unique_id++;
    klass._alloc      = constructor;
    klass._isClass    = true;
    klass._name       = id;
    klass._super      = superklass;
    klass.constructor = OpalClass;
    klass._methods    = [];
    klass.__inc__     = [];
    klass.__parent    = superklass;
    klass._proto      = constructor.prototype;

    constructor.prototype._klass = klass;

    Opal[id] = klass;
    Opal.constants.push(id);

    return klass;
  };

  /*
   * For performance, some core ruby classes are toll-free bridged to their
   * native javascript counterparts (e.g. a ruby Array is a javascript Array).
   *
   * This method is used to setup a native constructor (e.g. Array), to have
   * its prototype act like a normal ruby class. Firstly, a new ruby class is
   * created using the native constructor so that its prototype is set as the
   * target for th new class. Note: all bridged classes are set to inherit
   * from Object.
   *
   * Bridged classes are tracked in `bridged_classes` array so that methods
   * defined on Object can be "donated" to all bridged classes. This allows
   * us to fake the inheritance of a native prototype from our Object
   * prototype.
   *
   * Example:
   *
   *    bridge_class("Proc", Function);
   *
   * @param [String] name the name of the ruby class to create
   * @param [Function] constructor native javascript constructor to use
   * @return [Class] returns new ruby class
   */
  function bridge_class(name, constructor) {
    var klass = boot_class_meta(RubyObject, constructor);

    klass._name = name;

    create_scope(Opal, klass, name);
    bridged_classes.push(klass);

    var object_methods = RubyBasicObject._methods.concat(RubyObject._methods);

    for (var i = 0, len = object_methods.length; i < len; i++) {
      var meth = object_methods[i];
      constructor.prototype[meth] = RubyObject._proto[meth];
    }

    return klass;
  };

  /*
   * constant assign
   */
  Opal.casgn = function(base_module, name, value) {
    var scope = base_module._scope;

    if (value._isClass && value._name === nil) {
      value._name = name;
    }

    if (value._isClass) {
      value._base_module = base_module;
    }

    scope.constants.push(name);
    return scope[name] = value;
  };

  /*
   * constant decl
   */
  Opal.cdecl = function(base_scope, name, value) {
    base_scope.constants.push(name);
    return base_scope[name] = value;
  };

  /*
   * constant get
   */
  Opal.cget = function(base_scope, path) {
    if (path == null) {
      path       = base_scope;
      base_scope = Opal.Object;
    }

    var result = base_scope;

    path = path.split('::');
    while (path.length != 0) {
      result = result.$const_get(path.shift());
    }

    return result;
  }

  /*
   * When a source module is included into the target module, we must also copy
   * its constants to the target.
   */
  Opal.donate_constants = function(source_mod, target_mod) {
    var source_constants = source_mod._scope.constants,
        target_scope     = target_mod._scope,
        target_constants = target_scope.constants;

    for (var i = 0, length = source_constants.length; i < length; i++) {
      target_constants.push(source_constants[i]);
      target_scope[source_constants[i]] = source_mod._scope[source_constants[i]];
    }
  };

  /*
   * Methods stubs are used to facilitate method_missing in opal. A stub is a
   * placeholder function which just calls `method_missing` on the receiver.
   * If no method with the given name is actually defined on an object, then it
   * is obvious to say that the stub will be called instead, and then in turn
   * method_missing will be called.
   *
   * When a file in ruby gets compiled to javascript, it includes a call to
   * this function which adds stubs for every method name in the compiled file.
   * It should then be safe to assume that method_missing will work for any
   * method call detected.
   *
   * Method stubs are added to the BasicObject prototype, which every other
   * ruby object inherits, so all objects should handle method missing. A stub
   * is only added if the given property name (method name) is not already
   * defined.
   *
   * Note: all ruby methods have a `$` prefix in javascript, so all stubs will
   * have this prefix as well (to make this method more performant).
   *
   *    Opal.add_stubs(["$foo", "$bar", "$baz="]);
   *
   * All stub functions will have a private `rb_stub` property set to true so
   * that other internal methods can detect if a method is just a stub or not.
   * `Kernel#respond_to?` uses this property to detect a methods presence.
   *
   * @param [Array] stubs an array of method stubs to add
   */
  Opal.add_stubs = function(stubs) {
    for (var i = 0, length = stubs.length; i < length; i++) {
      var stub = stubs[i];

      if (!BasicObject.prototype[stub]) {
        BasicObject.prototype[stub] = true;
        add_stub_for(BasicObject.prototype, stub);
      }
    }
  };

  /*
   * Actuall add a method_missing stub function to the given prototype for the
   * given name.
   *
   * @param [Prototype] prototype the target prototype
   * @param [String] stub stub name to add (e.g. "$foo")
   */
  function add_stub_for(prototype, stub) {
    function method_missing_stub() {
      // Copy any given block onto the method_missing dispatcher
      this.$method_missing._p = method_missing_stub._p;

      // Set block property to null ready for the next call (stop false-positives)
      method_missing_stub._p = null;

      // call method missing with correct args (remove '$' prefix on method name)
      return this.$method_missing.apply(this, [stub.slice(1)].concat($slice.call(arguments)));
    }

    method_missing_stub.rb_stub = true;
    prototype[stub] = method_missing_stub;
  }

  // Expose for other parts of Opal to use
  Opal.add_stub_for = add_stub_for;

  // Const missing dispatcher
  Opal.cm = function(name) {
    return this.base.$const_missing(name);
  };

  // Arity count error dispatcher
  Opal.ac = function(actual, expected, object, meth) {
    var inspect = (object._isClass ? object._name + '.' : object._klass._name + '#') + meth;
    var msg = '[' + inspect + '] wrong number of arguments(' + actual + ' for ' + expected + ')';
    throw Opal.ArgumentError.$new(msg);
  };

  // Super dispatcher
  Opal.find_super_dispatcher = function(obj, jsid, current_func, iter, defs) {
    var dispatcher;

    if (defs) {
      dispatcher = obj._isClass ? defs._super : obj._klass._proto;
    }
    else {
      if (obj._isClass) {
        dispatcher = obj._super;
      }
      else {
        dispatcher = find_obj_super_dispatcher(obj, jsid, current_func);
      }
    }

    dispatcher = dispatcher['$' + jsid];
    dispatcher._p = iter;

    return dispatcher;
  };

  // Iter dispatcher for super in a block
  Opal.find_iter_super_dispatcher = function(obj, jsid, current_func, iter, defs) {
    if (current_func._def) {
      return Opal.find_super_dispatcher(obj, current_func._jsid, current_func, iter, defs);
    }
    else {
      return Opal.find_super_dispatcher(obj, jsid, current_func, iter, defs);
    }
  };

  var find_obj_super_dispatcher = function(obj, jsid, current_func) {
    var klass = obj.__meta__ || obj._klass;

    while (klass) {
      if (klass._proto['$' + jsid] === current_func) {
        // ok
        break;
      }

      klass = klass.__parent;
    }

    // if we arent in a class, we couldnt find current?
    if (!klass) {
      throw new Error("could not find current class for super()");
    }

    klass = klass.__parent;

    // else, let's find the next one
    while (klass) {
      var working = klass._proto['$' + jsid];

      if (working && working !== current_func) {
        // ok
        break;
      }

      klass = klass.__parent;
    }

    return klass._proto;
  };

  /*
   * Used to return as an expression. Sometimes, we can't simply return from
   * a javascript function as if we were a method, as the return is used as
   * an expression, or even inside a block which must "return" to the outer
   * method. This helper simply throws an error which is then caught by the
   * method. This approach is expensive, so it is only used when absolutely
   * needed.
   */
  Opal.$return = function(val) {
    Opal.returner.$v = val;
    throw Opal.returner;
  };

  // handles yield calls for 1 yielded arg
  Opal.$yield1 = function(block, arg) {
    if (typeof(block) !== "function") {
      throw Opal.LocalJumpError.$new("no block given");
    }

    if (block.length > 1) {
      if (arg._isArray) {
        return block.apply(null, arg);
      }
      else {
        return block(arg);
      }
    }
    else {
      return block(arg);
    }
  };

  // handles yield for > 1 yielded arg
  Opal.$yieldX = function(block, args) {
    if (typeof(block) !== "function") {
      throw Opal.LocalJumpError.$new("no block given");
    }

    if (block.length > 1 && args.length == 1) {
      if (args[0]._isArray) {
        return block.apply(null, args[0]);
      }
    }

    if (!args._isArray) {
      args = $slice.call(args);
    }

    return block.apply(null, args);
  };

  // Finds the corresponding exception match in candidates.  Each candidate can
  // be a value, or an array of values.  Returns null if not found.
  Opal.$rescue = function(exception, candidates) {
    for (var i = 0; i != candidates.length; i++) {
      var candidate = candidates[i];
      if (candidate._isArray) {
        var subresult;
        if (subresult = Opal.$rescue(exception, candidate)) {
          return subresult;
        }
      }
      else if (candidate['$==='](exception)) {
        return candidate;
      }
    }
    return null;
  };

  Opal.is_a = function(object, klass) {
    if (object.__meta__ === klass) {
      return true;
    }

    var search = object._klass;

    while (search) {
      if (search === klass) {
        return true;
      }

      for (var i = 0, length = search.__inc__.length; i < length; i++) {
        if (search.__inc__[i] == klass) {
          return true;
        }
      }

      search = search._super;
    }

    return false;
  }

  // Helper to convert the given object to an array
  Opal.to_ary = function(value) {
    if (value._isArray) {
      return value;
    }
    else if (value.$to_ary && !value.$to_ary.rb_stub) {
      return value.$to_ary();
    }

    return [value];
  };

  /*
    Call a ruby method on a ruby object with some arguments:

      var my_array = [1, 2, 3, 4]
      Opal.send(my_array, 'length')     # => 4
      Opal.send(my_array, 'reverse!')   # => [4, 3, 2, 1]

    A missing method will be forwarded to the object via
    method_missing.

    The result of either call with be returned.

    @param [Object] recv the ruby object
    @param [String] mid ruby method to call
  */
  Opal.send = function(recv, mid) {
    var args = $slice.call(arguments, 2),
        func = recv['$' + mid];

    if (func) {
      return func.apply(recv, args);
    }

    return recv.$method_missing.apply(recv, [mid].concat(args));
  };

  Opal.block_send = function(recv, mid, block) {
    var args = $slice.call(arguments, 3),
        func = recv['$' + mid];

    if (func) {
      func._p = block;
      return func.apply(recv, args);
    }

    return recv.$method_missing.apply(recv, [mid].concat(args));
  };

  /**
   * Donate methods for a class/module
   */
  Opal.donate = function(klass, defined, indirect) {
    var methods = klass._methods, included_in = klass.__dep__;

    // if (!indirect) {
      klass._methods = methods.concat(defined);
    // }

    if (included_in) {
      for (var i = 0, length = included_in.length; i < length; i++) {
        var includee = included_in[i];
        var dest = includee._proto;

        for (var j = 0, jj = defined.length; j < jj; j++) {
          var method = defined[j];
          dest[method] = klass._proto[method];
          dest[method]._donated = true;
        }

        if (includee.__dep__) {
          Opal.donate(includee, defined, true);
        }
      }
    }
  };

  Opal.defn = function(obj, jsid, body) {
    if (obj.__mod__) {
      obj._proto[jsid] = body;
      Opal.donate(obj, [jsid]);
    }
    else if (obj._isClass) {
      obj._proto[jsid] = body;

      if (obj === RubyBasicObject) {
        define_basic_object_method(jsid, body);
      }
      else if (obj === RubyObject) {
        Opal.donate(obj, [jsid]);
      }
    }
    else {
      obj[jsid] = body;
    }

    return nil;
  };

  /*
   * Define a singleton method on the given object.
   */
  Opal.defs = function(obj, jsid, body) {
    if (obj._isClass || obj.__mod__) {
      obj.constructor.prototype[jsid] = body;
    }
    else {
      obj[jsid] = body;
    }
  };

  function define_basic_object_method(jsid, body) {
    RubyBasicObject._methods.push(jsid);
    for (var i = 0, len = bridged_classes.length; i < len; i++) {
      bridged_classes[i]._proto[jsid] = body;
    }
  }

  Opal.hash = function() {
    if (arguments.length == 1 && arguments[0]._klass == Opal.Hash) {
      return arguments[0];
    }

    var hash   = new Opal.Hash._alloc,
        keys   = [],
        assocs = {};

    hash.map   = assocs;
    hash.keys  = keys;

    if (arguments.length == 1) {
      if (arguments[0]._isArray) {
        var args = arguments[0];

        for (var i = 0, length = args.length; i < length; i++) {
          var pair = args[i];

          if (pair.length !== 2) {
            throw Opal.ArgumentError.$new("value not of length 2: " + pair.$inspect());
          }

          var key = pair[0],
              obj = pair[1];

          if (assocs[key] == null) {
            keys.push(key);
          }

          assocs[key] = obj;
        }
      }
      else {
        var obj = arguments[0];
        for (var key in obj) {
          assocs[key] = obj[key];
          keys.push(key);
        }
      }
    }
    else {
      var length = arguments.length;
      if (length % 2 !== 0) {
        throw Opal.ArgumentError.$new("odd number of arguments for Hash");
      }

      for (var i = 0; i < length; i++) {
        var key = arguments[i],
            obj = arguments[++i];

        if (assocs[key] == null) {
          keys.push(key);
        }

        assocs[key] = obj;
      }
    }

    return hash;
  };

  /*
   * hash2 is a faster creator for hashes that just use symbols and
   * strings as keys. The map and keys array can be constructed at
   * compile time, so they are just added here by the constructor
   * function
   */
  Opal.hash2 = function(keys, map) {
    var hash = new Opal.Hash._alloc;

    hash.keys = keys;
    hash.map  = map;

    return hash;
  };

  /*
   * Create a new range instance with first and last values, and whether the
   * range excludes the last value.
   */
  Opal.range = function(first, last, exc) {
    var range         = new Opal.Range._alloc;
        range.begin   = first;
        range.end     = last;
        range.exclude = exc;

    return range;
  };

  // Initialization
  // --------------

  // Constructors for *instances* of core objects
  boot_defclass('BasicObject', BasicObject);
  boot_defclass('Object', Object, BasicObject);
  boot_defclass('Module', Module, Object);
  boot_defclass('Class', Class, Module);

  // Constructors for *classes* of core objects
  RubyBasicObject = boot_makemeta('BasicObject', BasicObject, Class);
  RubyObject      = boot_makemeta('Object', Object, RubyBasicObject.constructor);
  RubyModule      = boot_makemeta('Module', Module, RubyObject.constructor);
  RubyClass       = boot_makemeta('Class', Class, RubyModule.constructor);

  // Fix booted classes to use their metaclass
  RubyBasicObject._klass = RubyClass;
  RubyObject._klass = RubyClass;
  RubyModule._klass = RubyClass;
  RubyClass._klass = RubyClass;

  // Fix superclasses of booted classes
  RubyBasicObject._super = null;
  RubyObject._super = RubyBasicObject;
  RubyModule._super = RubyObject;
  RubyClass._super = RubyModule;

  // Internally, Object acts like a module as it is "included" into bridged
  // classes. In other words, we donate methods from Object into our bridged
  // classes as their prototypes don't inherit from our root Object, so they
  // act like module includes.
  RubyObject.__dep__ = bridged_classes;

  Opal.base = RubyObject;
  RubyBasicObject._scope = RubyObject._scope = Opal;
  RubyBasicObject._orig_scope = RubyObject._orig_scope = Opal;
  Opal.Kernel = RubyObject;

  RubyModule._scope = RubyObject._scope;
  RubyClass._scope = RubyObject._scope;
  RubyModule._orig_scope = RubyObject._orig_scope;
  RubyClass._orig_scope = RubyObject._orig_scope;

  RubyObject._proto.toString = function() {
    return this.$to_s();
  };

  Opal.top = new RubyObject._alloc();

  Opal.klass(RubyObject, RubyObject, 'NilClass', NilClass);

  var nil = Opal.nil = new NilClass;
  nil.call = nil.apply = function() { throw Opal.LocalJumpError.$new('no block given'); };

  Opal.breaker  = new Error('unexpected break');
  Opal.returner = new Error('unexpected return');

  bridge_class('Array', Array);
  bridge_class('Boolean', Boolean);
  bridge_class('Numeric', Number);
  bridge_class('String', String);
  bridge_class('Proc', Function);
  bridge_class('Exception', Error);
  bridge_class('Regexp', RegExp);
  bridge_class('Time', Date);

  TypeError._super = Error;
}).call(this);
/* Generated by Opal 0.6.2 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $module = $opal.module;

  $opal.add_stubs(['$new', '$class', '$===', '$respond_to?', '$raise', '$type_error', '$__send__', '$coerce_to', '$nil?', '$<=>', '$name', '$inspect']);
  return (function($base) {
    var self = $module($base, 'Opal');

    var def = self._proto, $scope = self._scope;

    $opal.defs(self, '$type_error', function(object, type, method, coerced) {
      var $a, $b, self = this;

      if (method == null) {
        method = nil
      }
      if (coerced == null) {
        coerced = nil
      }
      if ((($a = (($b = method !== false && method !== nil) ? coerced : $b)) !== nil && (!$a._isBoolean || $a == true))) {
        return (($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a).$new("can't convert " + (object.$class()) + " into " + (type) + " (" + (object.$class()) + "#" + (method) + " gives " + (coerced.$class()))
        } else {
        return (($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a).$new("no implicit conversion of " + (object.$class()) + " into " + (type))
      };
    });

    $opal.defs(self, '$coerce_to', function(object, type, method) {
      var $a, self = this;

      if ((($a = type['$==='](object)) !== nil && (!$a._isBoolean || $a == true))) {
        return object};
      if ((($a = object['$respond_to?'](method)) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        self.$raise(self.$type_error(object, type))
      };
      return object.$__send__(method);
    });

    $opal.defs(self, '$coerce_to!', function(object, type, method) {
      var $a, self = this, coerced = nil;

      coerced = self.$coerce_to(object, type, method);
      if ((($a = type['$==='](coerced)) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        self.$raise(self.$type_error(object, type, method, coerced))
      };
      return coerced;
    });

    $opal.defs(self, '$coerce_to?', function(object, type, method) {
      var $a, self = this, coerced = nil;

      if ((($a = object['$respond_to?'](method)) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        return nil
      };
      coerced = self.$coerce_to(object, type, method);
      if ((($a = coerced['$nil?']()) !== nil && (!$a._isBoolean || $a == true))) {
        return nil};
      if ((($a = type['$==='](coerced)) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        self.$raise(self.$type_error(object, type, method, coerced))
      };
      return coerced;
    });

    $opal.defs(self, '$try_convert', function(object, type, method) {
      var $a, self = this;

      if ((($a = type['$==='](object)) !== nil && (!$a._isBoolean || $a == true))) {
        return object};
      if ((($a = object['$respond_to?'](method)) !== nil && (!$a._isBoolean || $a == true))) {
        return object.$__send__(method)
        } else {
        return nil
      };
    });

    $opal.defs(self, '$compare', function(a, b) {
      var $a, self = this, compare = nil;

      compare = a['$<=>'](b);
      if ((($a = compare === nil) !== nil && (!$a._isBoolean || $a == true))) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "comparison of " + (a.$class().$name()) + " with " + (b.$class().$name()) + " failed")};
      return compare;
    });

    $opal.defs(self, '$destructure', function(args) {
      var self = this;

      
      if (args.length == 1) {
        return args[0];
      }
      else if (args._isArray) {
        return args;
      }
      else {
        return $slice.call(args);
      }
    
    });

    $opal.defs(self, '$respond_to?', function(obj, method) {
      var self = this;

      
      if (obj == null || !obj._klass) {
        return false;
      }
    
      return obj['$respond_to?'](method);
    });

    $opal.defs(self, '$inspect', function(obj) {
      var self = this;

      
      if (obj === undefined) {
        return "undefined";
      }
      else if (obj === null) {
        return "null";
      }
      else if (!obj._klass) {
        return obj.toString();
      }
      else {
        return obj.$inspect();
      }
    
    });
    
  })(self)
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/helpers.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;

  $opal.add_stubs(['$attr_reader', '$attr_writer', '$=~', '$raise', '$const_missing', '$to_str', '$to_proc', '$append_features', '$included', '$name', '$new', '$to_s']);
  return (function($base, $super) {
    function $Module(){};
    var self = $Module = $klass($base, $super, 'Module', $Module);

    var def = self._proto, $scope = self._scope, TMP_1, TMP_2, TMP_3, TMP_4;

    $opal.defs(self, '$new', TMP_1 = function() {
      var self = this, $iter = TMP_1._p, block = $iter || nil;

      TMP_1._p = null;
      
      function AnonModule(){}
      var klass     = Opal.boot(Opal.Module, AnonModule);
      klass._name   = nil;
      klass._klass  = Opal.Module;
      klass.__dep__ = []
      klass.__mod__ = true;
      klass._proto  = {};

      // inherit scope from parent
      $opal.create_scope(Opal.Module._scope, klass);

      if (block !== nil) {
        var block_self = block._s;
        block._s = null;
        block.call(klass);
        block._s = block_self;
      }

      return klass;
    
    });

    def['$==='] = function(object) {
      var $a, self = this;

      if ((($a = object == null) !== nil && (!$a._isBoolean || $a == true))) {
        return false};
      return $opal.is_a(object, self);
    };

    def['$<'] = function(other) {
      var self = this;

      
      var working = self;

      while (working) {
        if (working === other) {
          return true;
        }

        working = working.__parent;
      }

      return false;
    
    };

    def.$alias_method = function(newname, oldname) {
      var self = this;

      
      self._proto['$' + newname] = self._proto['$' + oldname];

      if (self._methods) {
        $opal.donate(self, ['$' + newname ])
      }
    
      return self;
    };

    def.$alias_native = function(mid, jsid) {
      var self = this;

      if (jsid == null) {
        jsid = mid
      }
      return self._proto['$' + mid] = self._proto[jsid];
    };

    def.$ancestors = function() {
      var self = this;

      
      var parent = self,
          result = [];

      while (parent) {
        result.push(parent);
        result = result.concat(parent.__inc__);

        parent = parent._super;
      }

      return result;
    
    };

    def.$append_features = function(klass) {
      var self = this;

      
      var module   = self,
          included = klass.__inc__;

      // check if this module is already included in the klass
      for (var i = 0, length = included.length; i < length; i++) {
        if (included[i] === module) {
          return;
        }
      }

      included.push(module);
      module.__dep__.push(klass);

      // iclass
      var iclass = {
        name: module._name,

        _proto:   module._proto,
        __parent: klass.__parent,
        __iclass: true
      };

      klass.__parent = iclass;

      var donator   = module._proto,
          prototype = klass._proto,
          methods   = module._methods;

      for (var i = 0, length = methods.length; i < length; i++) {
        var method = methods[i];

        if (prototype.hasOwnProperty(method) && !prototype[method]._donated) {
          // if the target class already has a method of the same name defined
          // and that method was NOT donated, then it must be a method defined
          // by the class so we do not want to override it
        }
        else {
          prototype[method] = donator[method];
          prototype[method]._donated = true;
        }
      }

      if (klass.__dep__) {
        $opal.donate(klass, methods.slice(), true);
      }

      $opal.donate_constants(module, klass);
    
      return self;
    };

    def.$attr_accessor = function(names) {
      var $a, $b, self = this;

      names = $slice.call(arguments, 0);
      ($a = self).$attr_reader.apply($a, [].concat(names));
      return ($b = self).$attr_writer.apply($b, [].concat(names));
    };

    def.$attr_reader = function(names) {
      var self = this;

      names = $slice.call(arguments, 0);
      
      var proto = self._proto, cls = self;
      for (var i = 0, length = names.length; i < length; i++) {
        (function(name) {
          proto[name] = nil;
          var func = function() { return this[name] };

          if (cls._isSingleton) {
            proto.constructor.prototype['$' + name] = func;
          }
          else {
            proto['$' + name] = func;
            $opal.donate(self, ['$' + name ]);
          }
        })(names[i]);
      }
    
      return nil;
    };

    def.$attr_writer = function(names) {
      var self = this;

      names = $slice.call(arguments, 0);
      
      var proto = self._proto, cls = self;
      for (var i = 0, length = names.length; i < length; i++) {
        (function(name) {
          proto[name] = nil;
          var func = function(value) { return this[name] = value; };

          if (cls._isSingleton) {
            proto.constructor.prototype['$' + name + '='] = func;
          }
          else {
            proto['$' + name + '='] = func;
            $opal.donate(self, ['$' + name + '=']);
          }
        })(names[i]);
      }
    
      return nil;
    };

    $opal.defn(self, '$attr', def.$attr_accessor);

    def.$constants = function() {
      var self = this;

      return self._scope.constants;
    };

    def['$const_defined?'] = function(name, inherit) {
      var $a, self = this;

      if (inherit == null) {
        inherit = true
      }
      if ((($a = name['$=~'](/^[A-Z]\w*$/)) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        self.$raise((($a = $scope.NameError) == null ? $opal.cm('NameError') : $a), "wrong constant name " + (name))
      };
      
      scopes = [self._scope];
      if (inherit || self === Opal.Object) {
        var parent = self._super;
        while (parent !== Opal.BasicObject) {
          scopes.push(parent._scope);
          parent = parent._super;
        }
      }

      for (var i = 0, len = scopes.length; i < len; i++) {
        if (scopes[i].hasOwnProperty(name)) {
          return true;
        }
      }

      return false;
    
    };

    def.$const_get = function(name, inherit) {
      var $a, self = this;

      if (inherit == null) {
        inherit = true
      }
      if ((($a = name['$=~'](/^[A-Z]\w*$/)) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        self.$raise((($a = $scope.NameError) == null ? $opal.cm('NameError') : $a), "wrong constant name " + (name))
      };
      
      var scopes = [self._scope];
      if (inherit || self == Opal.Object) {
        var parent = self._super;
        while (parent !== Opal.BasicObject) {
          scopes.push(parent._scope);
          parent = parent._super;
        }
      }

      for (var i = 0, len = scopes.length; i < len; i++) {
        if (scopes[i].hasOwnProperty(name)) {
          return scopes[i][name];
        }
      }

      return self.$const_missing(name);
    
    };

    def.$const_missing = function(const$) {
      var $a, self = this, name = nil;

      name = self._name;
      return self.$raise((($a = $scope.NameError) == null ? $opal.cm('NameError') : $a), "uninitialized constant " + (name) + "::" + (const$));
    };

    def.$const_set = function(name, value) {
      var $a, self = this;

      if ((($a = name['$=~'](/^[A-Z]\w*$/)) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        self.$raise((($a = $scope.NameError) == null ? $opal.cm('NameError') : $a), "wrong constant name " + (name))
      };
      try {
      name = name.$to_str()
      } catch ($err) {if (true) {
        self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "conversion with #to_str failed")
        }else { throw $err; }
      };
      
      $opal.casgn(self, name, value);
      return value
    ;
    };

    def.$define_method = TMP_2 = function(name, method) {
      var self = this, $iter = TMP_2._p, block = $iter || nil;

      TMP_2._p = null;
      
      if (method) {
        block = method.$to_proc();
      }

      if (block === nil) {
        throw new Error("no block given");
      }

      var jsid    = '$' + name;
      block._jsid = name;
      block._s    = null;
      block._def  = block;

      self._proto[jsid] = block;
      $opal.donate(self, [jsid]);

      return name;
    ;
    };

    def.$remove_method = function(name) {
      var self = this;

      
      var jsid    = '$' + name;
      var current = self._proto[jsid];
      delete self._proto[jsid];

      // Check if we need to reverse $opal.donate
      // $opal.retire(self, [jsid]);
      return self;
    
    };

    def.$include = function(mods) {
      var self = this;

      mods = $slice.call(arguments, 0);
      
      for (var i = mods.length - 1; i >= 0; i--) {
        var mod = mods[i];

        if (mod === self) {
          continue;
        }

        (mod).$append_features(self);
        (mod).$included(self);
      }
    
      return self;
    };

    def['$include?'] = function(mod) {
      var self = this;

      
      for (var cls = self; cls; cls = cls.parent) {
        for (var i = 0; i != cls.__inc__.length; i++) {
          var mod2 = cls.__inc__[i];
          if (mod === mod2) {
            return true;
          }
        }
      }
      return false;
    
    };

    def.$instance_method = function(name) {
      var $a, self = this;

      
      var meth = self._proto['$' + name];

      if (!meth || meth.rb_stub) {
        self.$raise((($a = $scope.NameError) == null ? $opal.cm('NameError') : $a), "undefined method `" + (name) + "' for class `" + (self.$name()) + "'");
      }

      return (($a = $scope.UnboundMethod) == null ? $opal.cm('UnboundMethod') : $a).$new(self, meth, name);
    
    };

    def.$instance_methods = function(include_super) {
      var self = this;

      if (include_super == null) {
        include_super = false
      }
      
      var methods = [], proto = self._proto;

      for (var prop in self._proto) {
        if (!include_super && !proto.hasOwnProperty(prop)) {
          continue;
        }

        if (!include_super && proto[prop]._donated) {
          continue;
        }

        if (prop.charAt(0) === '$') {
          methods.push(prop.substr(1));
        }
      }

      return methods;
    
    };

    def.$included = function(mod) {
      var self = this;

      return nil;
    };

    def.$extended = function(mod) {
      var self = this;

      return nil;
    };

    def.$module_eval = TMP_3 = function() {
      var $a, self = this, $iter = TMP_3._p, block = $iter || nil;

      TMP_3._p = null;
      if (block !== false && block !== nil) {
        } else {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "no block given")
      };
      
      var old = block._s,
          result;

      block._s = null;
      result = block.call(self);
      block._s = old;

      return result;
    
    };

    $opal.defn(self, '$class_eval', def.$module_eval);

    def.$module_exec = TMP_4 = function() {
      var self = this, $iter = TMP_4._p, block = $iter || nil;

      TMP_4._p = null;
      
      if (block === nil) {
        throw new Error("no block given");
      }

      var block_self = block._s, result;

      block._s = null;
      result = block.apply(self, $slice.call(arguments));
      block._s = block_self;

      return result;
    
    };

    $opal.defn(self, '$class_exec', def.$module_exec);

    def['$method_defined?'] = function(method) {
      var self = this;

      
      var body = self._proto['$' + method];
      return (!!body) && !body.rb_stub;
    
    };

    def.$module_function = function(methods) {
      var self = this;

      methods = $slice.call(arguments, 0);
      
      for (var i = 0, length = methods.length; i < length; i++) {
        var meth = methods[i], func = self._proto['$' + meth];

        self.constructor.prototype['$' + meth] = func;
      }

      return self;
    
    };

    def.$name = function() {
      var self = this;

      
      if (self._full_name) {
        return self._full_name;
      }

      var result = [], base = self;

      while (base) {
        if (base._name === nil) {
          return result.length === 0 ? nil : result.join('::');
        }

        result.unshift(base._name);

        base = base._base_module;

        if (base === $opal.Object) {
          break;
        }
      }

      if (result.length === 0) {
        return nil;
      }

      return self._full_name = result.join('::');
    
    };

    def.$public = function() {
      var self = this;

      return nil;
    };

    def.$private_class_method = function(name) {
      var self = this;

      return self['$' + name] || nil;
    };

    $opal.defn(self, '$private', def.$public);

    $opal.defn(self, '$protected', def.$public);

    def['$private_method_defined?'] = function(obj) {
      var self = this;

      return false;
    };

    def.$private_constant = function() {
      var self = this;

      return nil;
    };

    $opal.defn(self, '$protected_method_defined?', def['$private_method_defined?']);

    $opal.defn(self, '$public_instance_methods', def.$instance_methods);

    $opal.defn(self, '$public_method_defined?', def['$method_defined?']);

    def.$remove_class_variable = function() {
      var self = this;

      return nil;
    };

    def.$remove_const = function(name) {
      var self = this;

      
      var old = self._scope[name];
      delete self._scope[name];
      return old;
    
    };

    def.$to_s = function() {
      var self = this;

      return self.$name().$to_s();
    };

    return (def.$undef_method = function(symbol) {
      var self = this;

      $opal.add_stub_for(self._proto, "$" + symbol);
      return self;
    }, nil) && 'undef_method';
  })(self, null)
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/module.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;

  $opal.add_stubs(['$raise', '$allocate']);
  ;
  return (function($base, $super) {
    function $Class(){};
    var self = $Class = $klass($base, $super, 'Class', $Class);

    var def = self._proto, $scope = self._scope, TMP_1, TMP_2;

    $opal.defs(self, '$new', TMP_1 = function(sup) {
      var $a, self = this, $iter = TMP_1._p, block = $iter || nil;

      if (sup == null) {
        sup = (($a = $scope.Object) == null ? $opal.cm('Object') : $a)
      }
      TMP_1._p = null;
      
      if (!sup._isClass || sup.__mod__) {
        self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "superclass must be a Class");
      }

      function AnonClass(){};
      var klass       = Opal.boot(sup, AnonClass)
      klass._name     = nil;
      klass.__parent  = sup;

      // inherit scope from parent
      $opal.create_scope(sup._scope, klass);

      sup.$inherited(klass);

      if (block !== nil) {
        var block_self = block._s;
        block._s = null;
        block.call(klass);
        block._s = block_self;
      }

      return klass;
    ;
    });

    def.$allocate = function() {
      var self = this;

      
      var obj = new self._alloc;
      obj._id = Opal.uid();
      return obj;
    
    };

    def.$inherited = function(cls) {
      var self = this;

      return nil;
    };

    def.$new = TMP_2 = function(args) {
      var self = this, $iter = TMP_2._p, block = $iter || nil;

      args = $slice.call(arguments, 0);
      TMP_2._p = null;
      
      var obj = self.$allocate();

      obj.$initialize._p = block;
      obj.$initialize.apply(obj, args);
      return obj;
    ;
    };

    return (def.$superclass = function() {
      var self = this;

      return self._super || nil;
    }, nil) && 'superclass';
  })(self, null);
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/class.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;

  $opal.add_stubs(['$raise']);
  return (function($base, $super) {
    function $BasicObject(){};
    var self = $BasicObject = $klass($base, $super, 'BasicObject', $BasicObject);

    var def = self._proto, $scope = self._scope, TMP_1, TMP_2, TMP_3, TMP_4;

    $opal.defn(self, '$initialize', function() {
      var self = this;

      return nil;
    });

    $opal.defn(self, '$==', function(other) {
      var self = this;

      return self === other;
    });

    $opal.defn(self, '$__id__', function() {
      var self = this;

      return self._id || (self._id = Opal.uid());
    });

    $opal.defn(self, '$__send__', TMP_1 = function(symbol, args) {
      var self = this, $iter = TMP_1._p, block = $iter || nil;

      args = $slice.call(arguments, 1);
      TMP_1._p = null;
      
      var func = self['$' + symbol]

      if (func) {
        if (block !== nil) {
          func._p = block;
        }

        return func.apply(self, args);
      }

      if (block !== nil) {
        self.$method_missing._p = block;
      }

      return self.$method_missing.apply(self, [symbol].concat(args));
    
    });

    $opal.defn(self, '$!', function() {
      var self = this;

      return false;
    });

    $opal.defn(self, '$eql?', def['$==']);

    $opal.defn(self, '$equal?', def['$==']);

    $opal.defn(self, '$instance_eval', TMP_2 = function() {
      var $a, self = this, $iter = TMP_2._p, block = $iter || nil;

      TMP_2._p = null;
      if (block !== false && block !== nil) {
        } else {
        (($a = $scope.Kernel) == null ? $opal.cm('Kernel') : $a).$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "no block given")
      };
      
      var old = block._s,
          result;

      block._s = null;
      result = block.call(self, self);
      block._s = old;

      return result;
    
    });

    $opal.defn(self, '$instance_exec', TMP_3 = function(args) {
      var $a, self = this, $iter = TMP_3._p, block = $iter || nil;

      args = $slice.call(arguments, 0);
      TMP_3._p = null;
      if (block !== false && block !== nil) {
        } else {
        (($a = $scope.Kernel) == null ? $opal.cm('Kernel') : $a).$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "no block given")
      };
      
      var block_self = block._s,
          result;

      block._s = null;
      result = block.apply(self, args);
      block._s = block_self;

      return result;
    
    });

    return ($opal.defn(self, '$method_missing', TMP_4 = function(symbol, args) {
      var $a, self = this, $iter = TMP_4._p, block = $iter || nil;

      args = $slice.call(arguments, 1);
      TMP_4._p = null;
      return (($a = $scope.Kernel) == null ? $opal.cm('Kernel') : $a).$raise((($a = $scope.NoMethodError) == null ? $opal.cm('NoMethodError') : $a), "undefined method `" + (symbol) + "' for BasicObject instance");
    }), nil) && 'method_missing';
  })(self, null)
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/basic_object.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $module = $opal.module, $gvars = $opal.gvars;

  $opal.add_stubs(['$raise', '$inspect', '$==', '$name', '$class', '$new', '$respond_to?', '$to_ary', '$to_a', '$allocate', '$copy_instance_variables', '$initialize_clone', '$initialize_copy', '$singleton_class', '$initialize_dup', '$for', '$to_proc', '$append_features', '$extended', '$to_i', '$to_s', '$to_f', '$*', '$===', '$empty?', '$ArgumentError', '$nan?', '$infinite?', '$to_int', '$>', '$length', '$print', '$format', '$puts', '$each', '$<=', '$[]', '$nil?', '$is_a?', '$rand', '$coerce_to', '$respond_to_missing?']);
  return (function($base) {
    var self = $module($base, 'Kernel');

    var def = self._proto, $scope = self._scope, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5, TMP_6, TMP_7, TMP_9;

    def.$method_missing = TMP_1 = function(symbol, args) {
      var $a, self = this, $iter = TMP_1._p, block = $iter || nil;

      args = $slice.call(arguments, 1);
      TMP_1._p = null;
      return self.$raise((($a = $scope.NoMethodError) == null ? $opal.cm('NoMethodError') : $a), "undefined method `" + (symbol) + "' for " + (self.$inspect()));
    };

    def['$=~'] = function(obj) {
      var self = this;

      return false;
    };

    def['$==='] = function(other) {
      var self = this;

      return self['$=='](other);
    };

    def['$<=>'] = function(other) {
      var self = this;

      
      if (self['$=='](other)) {
        return 0;
      }

      return nil;
    ;
    };

    def.$method = function(name) {
      var $a, self = this;

      
      var meth = self['$' + name];

      if (!meth || meth.rb_stub) {
        self.$raise((($a = $scope.NameError) == null ? $opal.cm('NameError') : $a), "undefined method `" + (name) + "' for class `" + (self.$class().$name()) + "'");
      }

      return (($a = $scope.Method) == null ? $opal.cm('Method') : $a).$new(self, meth, name);
    
    };

    def.$methods = function(all) {
      var self = this;

      if (all == null) {
        all = true
      }
      
      var methods = [];

      for (var key in self) {
        if (key[0] == "$" && typeof(self[key]) === "function") {
          if (all == false || all === nil) {
            if (!$opal.hasOwnProperty.call(self, key)) {
              continue;
            }
          }
          if (self[key].rb_stub === undefined) {
            methods.push(key.substr(1));
          }
        }
      }

      return methods;
    
    };

    def.$Array = TMP_2 = function(object, args) {
      var self = this, $iter = TMP_2._p, block = $iter || nil;

      args = $slice.call(arguments, 1);
      TMP_2._p = null;
      
      if (object == null || object === nil) {
        return [];
      }
      else if (object['$respond_to?']("to_ary")) {
        return object.$to_ary();
      }
      else if (object['$respond_to?']("to_a")) {
        return object.$to_a();
      }
      else {
        return [object];
      }
    ;
    };

    def.$caller = function() {
      var self = this;

      return [];
    };

    def.$class = function() {
      var self = this;

      return self._klass;
    };

    def.$copy_instance_variables = function(other) {
      var self = this;

      
      for (var name in other) {
        if (name.charAt(0) !== '$') {
          if (name !== '_id' && name !== '_klass') {
            self[name] = other[name];
          }
        }
      }
    
    };

    def.$clone = function() {
      var self = this, copy = nil;

      copy = self.$class().$allocate();
      copy.$copy_instance_variables(self);
      copy.$initialize_clone(self);
      return copy;
    };

    def.$initialize_clone = function(other) {
      var self = this;

      return self.$initialize_copy(other);
    };

    def.$define_singleton_method = TMP_3 = function(name) {
      var $a, self = this, $iter = TMP_3._p, body = $iter || nil;

      TMP_3._p = null;
      if (body !== false && body !== nil) {
        } else {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "tried to create Proc object without a block")
      };
      
      var jsid   = '$' + name;
      body._jsid = name;
      body._s    = null;
      body._def  = body;

      self.$singleton_class()._proto[jsid] = body;

      return self;
    
    };

    def.$dup = function() {
      var self = this, copy = nil;

      copy = self.$class().$allocate();
      copy.$copy_instance_variables(self);
      copy.$initialize_dup(self);
      return copy;
    };

    def.$initialize_dup = function(other) {
      var self = this;

      return self.$initialize_copy(other);
    };

    def.$enum_for = TMP_4 = function(method, args) {
      var $a, $b, $c, self = this, $iter = TMP_4._p, block = $iter || nil;

      args = $slice.call(arguments, 1);
      if (method == null) {
        method = "each"
      }
      TMP_4._p = null;
      return ($a = ($b = (($c = $scope.Enumerator) == null ? $opal.cm('Enumerator') : $c)).$for, $a._p = block.$to_proc(), $a).apply($b, [self, method].concat(args));
    };

    $opal.defn(self, '$to_enum', def.$enum_for);

    def['$equal?'] = function(other) {
      var self = this;

      return self === other;
    };

    def.$extend = function(mods) {
      var self = this;

      mods = $slice.call(arguments, 0);
      
      var singleton = self.$singleton_class();

      for (var i = mods.length - 1; i >= 0; i--) {
        var mod = mods[i];

        (mod).$append_features(singleton);
        (mod).$extended(self);
      }
    ;
      return self;
    };

    def.$format = function(format, args) {
      var self = this;

      args = $slice.call(arguments, 1);
      
      var idx = 0;
      return format.replace(/%(\d+\$)?([-+ 0]*)(\d*|\*(\d+\$)?)(?:\.(\d*|\*(\d+\$)?))?([cspdiubBoxXfgeEG])|(%%)/g, function(str, idx_str, flags, width_str, w_idx_str, prec_str, p_idx_str, spec, escaped) {
        if (escaped) {
          return '%';
        }

        var width,
        prec,
        is_integer_spec = ("diubBoxX".indexOf(spec) != -1),
        is_float_spec = ("eEfgG".indexOf(spec) != -1),
        prefix = '',
        obj;

        if (width_str === undefined) {
          width = undefined;
        } else if (width_str.charAt(0) == '*') {
          var w_idx = idx++;
          if (w_idx_str) {
            w_idx = parseInt(w_idx_str, 10) - 1;
          }
          width = (args[w_idx]).$to_i();
        } else {
          width = parseInt(width_str, 10);
        }
        if (!prec_str) {
          prec = is_float_spec ? 6 : undefined;
        } else if (prec_str.charAt(0) == '*') {
          var p_idx = idx++;
          if (p_idx_str) {
            p_idx = parseInt(p_idx_str, 10) - 1;
          }
          prec = (args[p_idx]).$to_i();
        } else {
          prec = parseInt(prec_str, 10);
        }
        if (idx_str) {
          idx = parseInt(idx_str, 10) - 1;
        }
        switch (spec) {
        case 'c':
          obj = args[idx];
          if (obj._isString) {
            str = obj.charAt(0);
          } else {
            str = String.fromCharCode((obj).$to_i());
          }
          break;
        case 's':
          str = (args[idx]).$to_s();
          if (prec !== undefined) {
            str = str.substr(0, prec);
          }
          break;
        case 'p':
          str = (args[idx]).$inspect();
          if (prec !== undefined) {
            str = str.substr(0, prec);
          }
          break;
        case 'd':
        case 'i':
        case 'u':
          str = (args[idx]).$to_i().toString();
          break;
        case 'b':
        case 'B':
          str = (args[idx]).$to_i().toString(2);
          break;
        case 'o':
          str = (args[idx]).$to_i().toString(8);
          break;
        case 'x':
        case 'X':
          str = (args[idx]).$to_i().toString(16);
          break;
        case 'e':
        case 'E':
          str = (args[idx]).$to_f().toExponential(prec);
          break;
        case 'f':
          str = (args[idx]).$to_f().toFixed(prec);
          break;
        case 'g':
        case 'G':
          str = (args[idx]).$to_f().toPrecision(prec);
          break;
        }
        idx++;
        if (is_integer_spec || is_float_spec) {
          if (str.charAt(0) == '-') {
            prefix = '-';
            str = str.substr(1);
          } else {
            if (flags.indexOf('+') != -1) {
              prefix = '+';
            } else if (flags.indexOf(' ') != -1) {
              prefix = ' ';
            }
          }
        }
        if (is_integer_spec && prec !== undefined) {
          if (str.length < prec) {
            str = "0"['$*'](prec - str.length) + str;
          }
        }
        var total_len = prefix.length + str.length;
        if (width !== undefined && total_len < width) {
          if (flags.indexOf('-') != -1) {
            str = str + " "['$*'](width - total_len);
          } else {
            var pad_char = ' ';
            if (flags.indexOf('0') != -1) {
              str = "0"['$*'](width - total_len) + str;
            } else {
              prefix = " "['$*'](width - total_len) + prefix;
            }
          }
        }
        var result = prefix + str;
        if ('XEG'.indexOf(spec) != -1) {
          result = result.toUpperCase();
        }
        return result;
      });
    
    };

    def.$hash = function() {
      var self = this;

      return self._id;
    };

    def.$initialize_copy = function(other) {
      var self = this;

      return nil;
    };

    def.$inspect = function() {
      var self = this;

      return self.$to_s();
    };

    def['$instance_of?'] = function(klass) {
      var self = this;

      return self._klass === klass;
    };

    def['$instance_variable_defined?'] = function(name) {
      var self = this;

      return $opal.hasOwnProperty.call(self, name.substr(1));
    };

    def.$instance_variable_get = function(name) {
      var self = this;

      
      var ivar = self[name.substr(1)];

      return ivar == null ? nil : ivar;
    
    };

    def.$instance_variable_set = function(name, value) {
      var self = this;

      return self[name.substr(1)] = value;
    };

    def.$instance_variables = function() {
      var self = this;

      
      var result = [];

      for (var name in self) {
        if (name.charAt(0) !== '$') {
          if (name !== '_klass' && name !== '_id') {
            result.push('@' + name);
          }
        }
      }

      return result;
    
    };

    def.$Integer = function(value, base) {
      var $a, $b, self = this, $case = nil;

      if (base == null) {
        base = nil
      }
      if ((($a = (($b = $scope.String) == null ? $opal.cm('String') : $b)['$==='](value)) !== nil && (!$a._isBoolean || $a == true))) {
        if ((($a = value['$empty?']()) !== nil && (!$a._isBoolean || $a == true))) {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "invalid value for Integer: (empty string)")};
        return parseInt(value, ((($a = base) !== false && $a !== nil) ? $a : undefined));};
      if (base !== false && base !== nil) {
        self.$raise(self.$ArgumentError("base is only valid for String values"))};
      return (function() {$case = value;if ((($a = $scope.Integer) == null ? $opal.cm('Integer') : $a)['$===']($case)) {return value}else if ((($a = $scope.Float) == null ? $opal.cm('Float') : $a)['$===']($case)) {if ((($a = ((($b = value['$nan?']()) !== false && $b !== nil) ? $b : value['$infinite?']())) !== nil && (!$a._isBoolean || $a == true))) {
        self.$raise((($a = $scope.FloatDomainError) == null ? $opal.cm('FloatDomainError') : $a), "unable to coerce " + (value) + " to Integer")};
      return value.$to_int();}else if ((($a = $scope.NilClass) == null ? $opal.cm('NilClass') : $a)['$===']($case)) {return self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "can't convert nil into Integer")}else {if ((($a = value['$respond_to?']("to_int")) !== nil && (!$a._isBoolean || $a == true))) {
        return value.$to_int()
      } else if ((($a = value['$respond_to?']("to_i")) !== nil && (!$a._isBoolean || $a == true))) {
        return value.$to_i()
        } else {
        return self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "can't convert " + (value.$class()) + " into Integer")
      }}})();
    };

    def.$Float = function(value) {
      var $a, $b, self = this;

      if ((($a = (($b = $scope.String) == null ? $opal.cm('String') : $b)['$==='](value)) !== nil && (!$a._isBoolean || $a == true))) {
        return parseFloat(value);
      } else if ((($a = value['$respond_to?']("to_f")) !== nil && (!$a._isBoolean || $a == true))) {
        return value.$to_f()
        } else {
        return self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "can't convert " + (value.$class()) + " into Float")
      };
    };

    def['$is_a?'] = function(klass) {
      var self = this;

      return $opal.is_a(self, klass);
    };

    $opal.defn(self, '$kind_of?', def['$is_a?']);

    def.$lambda = TMP_5 = function() {
      var self = this, $iter = TMP_5._p, block = $iter || nil;

      TMP_5._p = null;
      block.is_lambda = true;
      return block;
    };

    def.$loop = TMP_6 = function() {
      var self = this, $iter = TMP_6._p, block = $iter || nil;

      TMP_6._p = null;
      
      while (true) {
        if (block() === $breaker) {
          return $breaker.$v;
        }
      }
    
      return self;
    };

    def['$nil?'] = function() {
      var self = this;

      return false;
    };

    $opal.defn(self, '$object_id', def.$__id__);

    def.$printf = function(args) {
      var $a, self = this;

      args = $slice.call(arguments, 0);
      if (args.$length()['$>'](0)) {
        self.$print(($a = self).$format.apply($a, [].concat(args)))};
      return nil;
    };

    def.$private_methods = function() {
      var self = this;

      return [];
    };

    def.$proc = TMP_7 = function() {
      var $a, self = this, $iter = TMP_7._p, block = $iter || nil;

      TMP_7._p = null;
      if (block !== false && block !== nil) {
        } else {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "tried to create Proc object without a block")
      };
      block.is_lambda = false;
      return block;
    };

    def.$puts = function(strs) {
      var $a, self = this;
      if ($gvars.stdout == null) $gvars.stdout = nil;

      strs = $slice.call(arguments, 0);
      return ($a = $gvars.stdout).$puts.apply($a, [].concat(strs));
    };

    def.$p = function(args) {
      var $a, $b, TMP_8, self = this;

      args = $slice.call(arguments, 0);
      ($a = ($b = args).$each, $a._p = (TMP_8 = function(obj){var self = TMP_8._s || this;
        if ($gvars.stdout == null) $gvars.stdout = nil;
if (obj == null) obj = nil;
      return $gvars.stdout.$puts(obj.$inspect())}, TMP_8._s = self, TMP_8), $a).call($b);
      if (args.$length()['$<='](1)) {
        return args['$[]'](0)
        } else {
        return args
      };
    };

    def.$print = function(strs) {
      var $a, self = this;
      if ($gvars.stdout == null) $gvars.stdout = nil;

      strs = $slice.call(arguments, 0);
      return ($a = $gvars.stdout).$print.apply($a, [].concat(strs));
    };

    def.$warn = function(strs) {
      var $a, $b, self = this;
      if ($gvars.VERBOSE == null) $gvars.VERBOSE = nil;
      if ($gvars.stderr == null) $gvars.stderr = nil;

      strs = $slice.call(arguments, 0);
      if ((($a = ((($b = $gvars.VERBOSE['$nil?']()) !== false && $b !== nil) ? $b : strs['$empty?']())) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        ($a = $gvars.stderr).$puts.apply($a, [].concat(strs))
      };
      return nil;
    };

    def.$raise = function(exception, string) {
      var $a, self = this;
      if ($gvars["!"] == null) $gvars["!"] = nil;

      
      if (exception == null && $gvars["!"]) {
        exception = $gvars["!"];
      }
      else if (exception._isString) {
        exception = (($a = $scope.RuntimeError) == null ? $opal.cm('RuntimeError') : $a).$new(exception);
      }
      else if (!exception['$is_a?']((($a = $scope.Exception) == null ? $opal.cm('Exception') : $a))) {
        exception = exception.$new(string);
      }

      $gvars["!"] = exception;
      throw exception;
    ;
    };

    $opal.defn(self, '$fail', def.$raise);

    def.$rand = function(max) {
      var $a, self = this;

      
      if (max === undefined) {
        return Math.random();
      }
      else if (max._isRange) {
        var arr = max.$to_a();

        return arr[self.$rand(arr.length)];
      }
      else {
        return Math.floor(Math.random() *
          Math.abs((($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(max, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int")));
      }
    
    };

    $opal.defn(self, '$srand', def.$rand);

    def['$respond_to?'] = function(name, include_all) {
      var $a, self = this;

      if (include_all == null) {
        include_all = false
      }
      if ((($a = self['$respond_to_missing?'](name)) !== nil && (!$a._isBoolean || $a == true))) {
        return true};
      
      var body = self['$' + name];

      if (typeof(body) === "function" && !body.rb_stub) {
        return true;
      }
    
      return false;
    };

    $opal.defn(self, '$send', def.$__send__);

    $opal.defn(self, '$public_send', def.$__send__);

    def.$singleton_class = function() {
      var self = this;

      
      if (self._isClass) {
        if (self.__meta__) {
          return self.__meta__;
        }

        var meta = new $opal.Class._alloc;
        meta._klass = $opal.Class;
        self.__meta__ = meta;
        // FIXME - is this right? (probably - methods defined on
        // class' singleton should also go to subclasses?)
        meta._proto = self.constructor.prototype;
        meta._isSingleton = true;
        meta.__inc__ = [];
        meta._methods = [];

        meta._scope = self._scope;

        return meta;
      }

      if (self._isClass) {
        return self._klass;
      }

      if (self.__meta__) {
        return self.__meta__;
      }

      else {
        var orig_class = self._klass,
            class_id   = "#<Class:#<" + orig_class._name + ":" + orig_class._id + ">>";

        var Singleton = function () {};
        var meta = Opal.boot(orig_class, Singleton);
        meta._name = class_id;

        meta._proto = self;
        self.__meta__ = meta;
        meta._klass = orig_class._klass;
        meta._scope = orig_class._scope;
        meta.__parent = orig_class;

        return meta;
      }
    
    };

    $opal.defn(self, '$sprintf', def.$format);

    def.$String = function(str) {
      var self = this;

      return String(str);
    };

    def.$tap = TMP_9 = function() {
      var self = this, $iter = TMP_9._p, block = $iter || nil;

      TMP_9._p = null;
      if ($opal.$yield1(block, self) === $breaker) return $breaker.$v;
      return self;
    };

    def.$to_proc = function() {
      var self = this;

      return self;
    };

    def.$to_s = function() {
      var self = this;

      return "#<" + self.$class().$name() + ":" + self._id + ">";
    };

    def.$freeze = function() {
      var self = this;

      self.___frozen___ = true;
      return self;
    };

    def['$frozen?'] = function() {
      var $a, self = this;
      if (self.___frozen___ == null) self.___frozen___ = nil;

      return ((($a = self.___frozen___) !== false && $a !== nil) ? $a : false);
    };

    def['$respond_to_missing?'] = function(method_name) {
      var self = this;

      return false;
    };
        ;$opal.donate(self, ["$method_missing", "$=~", "$===", "$<=>", "$method", "$methods", "$Array", "$caller", "$class", "$copy_instance_variables", "$clone", "$initialize_clone", "$define_singleton_method", "$dup", "$initialize_dup", "$enum_for", "$to_enum", "$equal?", "$extend", "$format", "$hash", "$initialize_copy", "$inspect", "$instance_of?", "$instance_variable_defined?", "$instance_variable_get", "$instance_variable_set", "$instance_variables", "$Integer", "$Float", "$is_a?", "$kind_of?", "$lambda", "$loop", "$nil?", "$object_id", "$printf", "$private_methods", "$proc", "$puts", "$p", "$print", "$warn", "$raise", "$fail", "$rand", "$srand", "$respond_to?", "$send", "$public_send", "$singleton_class", "$sprintf", "$String", "$tap", "$to_proc", "$to_s", "$freeze", "$frozen?", "$respond_to_missing?"]);
  })(self)
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/kernel.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;

  $opal.add_stubs(['$raise']);
  (function($base, $super) {
    function $NilClass(){};
    var self = $NilClass = $klass($base, $super, 'NilClass', $NilClass);

    var def = self._proto, $scope = self._scope;

    def['$!'] = function() {
      var self = this;

      return true;
    };

    def['$&'] = function(other) {
      var self = this;

      return false;
    };

    def['$|'] = function(other) {
      var self = this;

      return other !== false && other !== nil;
    };

    def['$^'] = function(other) {
      var self = this;

      return other !== false && other !== nil;
    };

    def['$=='] = function(other) {
      var self = this;

      return other === nil;
    };

    def.$dup = function() {
      var $a, self = this;

      return self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a));
    };

    def.$inspect = function() {
      var self = this;

      return "nil";
    };

    def['$nil?'] = function() {
      var self = this;

      return true;
    };

    def.$singleton_class = function() {
      var $a, self = this;

      return (($a = $scope.NilClass) == null ? $opal.cm('NilClass') : $a);
    };

    def.$to_a = function() {
      var self = this;

      return [];
    };

    def.$to_h = function() {
      var self = this;

      return $opal.hash();
    };

    def.$to_i = function() {
      var self = this;

      return 0;
    };

    $opal.defn(self, '$to_f', def.$to_i);

    def.$to_s = function() {
      var self = this;

      return "";
    };

    def.$object_id = function() {
      var $a, self = this;

      return (($a = $scope.NilClass) == null ? $opal.cm('NilClass') : $a)._id || ((($a = $scope.NilClass) == null ? $opal.cm('NilClass') : $a)._id = $opal.uid());
    };

    return $opal.defn(self, '$hash', def.$object_id);
  })(self, null);
  return $opal.cdecl($scope, 'NIL', nil);
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/nil_class.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var $a, self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;

  $opal.add_stubs(['$undef_method']);
  (function($base, $super) {
    function $Boolean(){};
    var self = $Boolean = $klass($base, $super, 'Boolean', $Boolean);

    var def = self._proto, $scope = self._scope;

    def._isBoolean = true;

    (function(self) {
      var $scope = self._scope, def = self._proto;

      return self.$undef_method("new")
    })(self.$singleton_class());

    def['$!'] = function() {
      var self = this;

      return self != true;
    };

    def['$&'] = function(other) {
      var self = this;

      return (self == true) ? (other !== false && other !== nil) : false;
    };

    def['$|'] = function(other) {
      var self = this;

      return (self == true) ? true : (other !== false && other !== nil);
    };

    def['$^'] = function(other) {
      var self = this;

      return (self == true) ? (other === false || other === nil) : (other !== false && other !== nil);
    };

    def['$=='] = function(other) {
      var self = this;

      return (self == true) === other.valueOf();
    };

    $opal.defn(self, '$equal?', def['$==']);

    $opal.defn(self, '$singleton_class', def.$class);

    return (def.$to_s = function() {
      var self = this;

      return (self == true) ? 'true' : 'false';
    }, nil) && 'to_s';
  })(self, null);
  $opal.cdecl($scope, 'TrueClass', (($a = $scope.Boolean) == null ? $opal.cm('Boolean') : $a));
  $opal.cdecl($scope, 'FalseClass', (($a = $scope.Boolean) == null ? $opal.cm('Boolean') : $a));
  $opal.cdecl($scope, 'TRUE', true);
  return $opal.cdecl($scope, 'FALSE', false);
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/boolean.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var $a, self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass, $module = $opal.module;

  $opal.add_stubs(['$attr_reader', '$name', '$class']);
  (function($base, $super) {
    function $Exception(){};
    var self = $Exception = $klass($base, $super, 'Exception', $Exception);

    var def = self._proto, $scope = self._scope;

    def.message = nil;
    self.$attr_reader("message");

    $opal.defs(self, '$new', function(message) {
      var self = this;

      if (message == null) {
        message = ""
      }
      
      var err = new Error(message);
      err._klass = self;
      err.name = self._name;
      return err;
    
    });

    def.$backtrace = function() {
      var self = this;

      
      var backtrace = self.stack;

      if (typeof(backtrace) === 'string') {
        return backtrace.split("\n").slice(0, 15);
      }
      else if (backtrace) {
        return backtrace.slice(0, 15);
      }

      return [];
    
    };

    def.$inspect = function() {
      var self = this;

      return "#<" + (self.$class().$name()) + ": '" + (self.message) + "'>";
    };

    return $opal.defn(self, '$to_s', def.$message);
  })(self, null);
  (function($base, $super) {
    function $ScriptError(){};
    var self = $ScriptError = $klass($base, $super, 'ScriptError', $ScriptError);

    var def = self._proto, $scope = self._scope;

    return nil;
  })(self, (($a = $scope.Exception) == null ? $opal.cm('Exception') : $a));
  (function($base, $super) {
    function $SyntaxError(){};
    var self = $SyntaxError = $klass($base, $super, 'SyntaxError', $SyntaxError);

    var def = self._proto, $scope = self._scope;

    return nil;
  })(self, (($a = $scope.ScriptError) == null ? $opal.cm('ScriptError') : $a));
  (function($base, $super) {
    function $LoadError(){};
    var self = $LoadError = $klass($base, $super, 'LoadError', $LoadError);

    var def = self._proto, $scope = self._scope;

    return nil;
  })(self, (($a = $scope.ScriptError) == null ? $opal.cm('ScriptError') : $a));
  (function($base, $super) {
    function $NotImplementedError(){};
    var self = $NotImplementedError = $klass($base, $super, 'NotImplementedError', $NotImplementedError);

    var def = self._proto, $scope = self._scope;

    return nil;
  })(self, (($a = $scope.ScriptError) == null ? $opal.cm('ScriptError') : $a));
  (function($base, $super) {
    function $SystemExit(){};
    var self = $SystemExit = $klass($base, $super, 'SystemExit', $SystemExit);

    var def = self._proto, $scope = self._scope;

    return nil;
  })(self, (($a = $scope.Exception) == null ? $opal.cm('Exception') : $a));
  (function($base, $super) {
    function $StandardError(){};
    var self = $StandardError = $klass($base, $super, 'StandardError', $StandardError);

    var def = self._proto, $scope = self._scope;

    return nil;
  })(self, (($a = $scope.Exception) == null ? $opal.cm('Exception') : $a));
  (function($base, $super) {
    function $NameError(){};
    var self = $NameError = $klass($base, $super, 'NameError', $NameError);

    var def = self._proto, $scope = self._scope;

    return nil;
  })(self, (($a = $scope.StandardError) == null ? $opal.cm('StandardError') : $a));
  (function($base, $super) {
    function $NoMethodError(){};
    var self = $NoMethodError = $klass($base, $super, 'NoMethodError', $NoMethodError);

    var def = self._proto, $scope = self._scope;

    return nil;
  })(self, (($a = $scope.NameError) == null ? $opal.cm('NameError') : $a));
  (function($base, $super) {
    function $RuntimeError(){};
    var self = $RuntimeError = $klass($base, $super, 'RuntimeError', $RuntimeError);

    var def = self._proto, $scope = self._scope;

    return nil;
  })(self, (($a = $scope.StandardError) == null ? $opal.cm('StandardError') : $a));
  (function($base, $super) {
    function $LocalJumpError(){};
    var self = $LocalJumpError = $klass($base, $super, 'LocalJumpError', $LocalJumpError);

    var def = self._proto, $scope = self._scope;

    return nil;
  })(self, (($a = $scope.StandardError) == null ? $opal.cm('StandardError') : $a));
  (function($base, $super) {
    function $TypeError(){};
    var self = $TypeError = $klass($base, $super, 'TypeError', $TypeError);

    var def = self._proto, $scope = self._scope;

    return nil;
  })(self, (($a = $scope.StandardError) == null ? $opal.cm('StandardError') : $a));
  (function($base, $super) {
    function $ArgumentError(){};
    var self = $ArgumentError = $klass($base, $super, 'ArgumentError', $ArgumentError);

    var def = self._proto, $scope = self._scope;

    return nil;
  })(self, (($a = $scope.StandardError) == null ? $opal.cm('StandardError') : $a));
  (function($base, $super) {
    function $IndexError(){};
    var self = $IndexError = $klass($base, $super, 'IndexError', $IndexError);

    var def = self._proto, $scope = self._scope;

    return nil;
  })(self, (($a = $scope.StandardError) == null ? $opal.cm('StandardError') : $a));
  (function($base, $super) {
    function $StopIteration(){};
    var self = $StopIteration = $klass($base, $super, 'StopIteration', $StopIteration);

    var def = self._proto, $scope = self._scope;

    return nil;
  })(self, (($a = $scope.IndexError) == null ? $opal.cm('IndexError') : $a));
  (function($base, $super) {
    function $KeyError(){};
    var self = $KeyError = $klass($base, $super, 'KeyError', $KeyError);

    var def = self._proto, $scope = self._scope;

    return nil;
  })(self, (($a = $scope.IndexError) == null ? $opal.cm('IndexError') : $a));
  (function($base, $super) {
    function $RangeError(){};
    var self = $RangeError = $klass($base, $super, 'RangeError', $RangeError);

    var def = self._proto, $scope = self._scope;

    return nil;
  })(self, (($a = $scope.StandardError) == null ? $opal.cm('StandardError') : $a));
  (function($base, $super) {
    function $FloatDomainError(){};
    var self = $FloatDomainError = $klass($base, $super, 'FloatDomainError', $FloatDomainError);

    var def = self._proto, $scope = self._scope;

    return nil;
  })(self, (($a = $scope.RangeError) == null ? $opal.cm('RangeError') : $a));
  (function($base, $super) {
    function $IOError(){};
    var self = $IOError = $klass($base, $super, 'IOError', $IOError);

    var def = self._proto, $scope = self._scope;

    return nil;
  })(self, (($a = $scope.StandardError) == null ? $opal.cm('StandardError') : $a));
  (function($base, $super) {
    function $SystemCallError(){};
    var self = $SystemCallError = $klass($base, $super, 'SystemCallError', $SystemCallError);

    var def = self._proto, $scope = self._scope;

    return nil;
  })(self, (($a = $scope.StandardError) == null ? $opal.cm('StandardError') : $a));
  return (function($base) {
    var self = $module($base, 'Errno');

    var def = self._proto, $scope = self._scope, $a;

    (function($base, $super) {
      function $EINVAL(){};
      var self = $EINVAL = $klass($base, $super, 'EINVAL', $EINVAL);

      var def = self._proto, $scope = self._scope, TMP_1;

      return ($opal.defs(self, '$new', TMP_1 = function() {
        var self = this, $iter = TMP_1._p, $yield = $iter || nil;

        TMP_1._p = null;
        return $opal.find_super_dispatcher(self, 'new', TMP_1, null, $EINVAL).apply(self, ["Invalid argument"]);
      }), nil) && 'new'
    })(self, (($a = $scope.SystemCallError) == null ? $opal.cm('SystemCallError') : $a))
    
  })(self);
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/error.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass, $gvars = $opal.gvars;

  $opal.add_stubs(['$respond_to?', '$to_str', '$to_s', '$coerce_to', '$new', '$raise', '$class', '$call']);
  return (function($base, $super) {
    function $Regexp(){};
    var self = $Regexp = $klass($base, $super, 'Regexp', $Regexp);

    var def = self._proto, $scope = self._scope, TMP_1;

    def._isRegexp = true;

    (function(self) {
      var $scope = self._scope, def = self._proto;

      self._proto.$escape = function(string) {
        var self = this;

        
        return string.replace(/([-[\]/{}()*+?.^$\\| ])/g, '\\$1')
                     .replace(/[\n]/g, '\\n')
                     .replace(/[\r]/g, '\\r')
                     .replace(/[\f]/g, '\\f')
                     .replace(/[\t]/g, '\\t');
      
      };
      self._proto.$quote = self._proto.$escape;
      self._proto.$union = function(parts) {
        var self = this;

        parts = $slice.call(arguments, 0);
        return new RegExp(parts.join(''));
      };
      return (self._proto.$new = function(regexp, options) {
        var self = this;

        return new RegExp(regexp, options);
      }, nil) && 'new';
    })(self.$singleton_class());

    def['$=='] = function(other) {
      var self = this;

      return other.constructor == RegExp && self.toString() === other.toString();
    };

    def['$==='] = function(str) {
      var self = this;

      
      if (!str._isString && str['$respond_to?']("to_str")) {
        str = str.$to_str();
      }

      if (!str._isString) {
        return false;
      }

      return self.test(str);
    ;
    };

    def['$=~'] = function(string) {
      var $a, self = this;

      if ((($a = string === nil) !== nil && (!$a._isBoolean || $a == true))) {
        $gvars["~"] = $gvars["`"] = $gvars["'"] = nil;
        return nil;};
      string = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(string, (($a = $scope.String) == null ? $opal.cm('String') : $a), "to_str").$to_s();
      
      var re = self;

      if (re.global) {
        // should we clear it afterwards too?
        re.lastIndex = 0;
      }
      else {
        // rewrite regular expression to add the global flag to capture pre/post match
        re = new RegExp(re.source, 'g' + (re.multiline ? 'm' : '') + (re.ignoreCase ? 'i' : ''));
      }

      var result = re.exec(string);

      if (result) {
        $gvars["~"] = (($a = $scope.MatchData) == null ? $opal.cm('MatchData') : $a).$new(re, result);
      }
      else {
        $gvars["~"] = $gvars["`"] = $gvars["'"] = nil;
      }

      return result ? result.index : nil;
    
    };

    $opal.defn(self, '$eql?', def['$==']);

    def.$inspect = function() {
      var self = this;

      return self.toString();
    };

    def.$match = TMP_1 = function(string, pos) {
      var $a, self = this, $iter = TMP_1._p, block = $iter || nil;

      TMP_1._p = null;
      if ((($a = string === nil) !== nil && (!$a._isBoolean || $a == true))) {
        $gvars["~"] = $gvars["`"] = $gvars["'"] = nil;
        return nil;};
      if ((($a = string._isString == null) !== nil && (!$a._isBoolean || $a == true))) {
        if ((($a = string['$respond_to?']("to_str")) !== nil && (!$a._isBoolean || $a == true))) {
          } else {
          self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "no implicit conversion of " + (string.$class()) + " into String")
        };
        string = string.$to_str();};
      
      var re = self;

      if (re.global) {
        // should we clear it afterwards too?
        re.lastIndex = 0;
      }
      else {
        re = new RegExp(re.source, 'g' + (re.multiline ? 'm' : '') + (re.ignoreCase ? 'i' : ''));
      }

      var result = re.exec(string);

      if (result) {
        result = $gvars["~"] = (($a = $scope.MatchData) == null ? $opal.cm('MatchData') : $a).$new(re, result);

        if (block === nil) {
          return result;
        }
        else {
          return block.$call(result);
        }
      }
      else {
        return $gvars["~"] = $gvars["`"] = $gvars["'"] = nil;
      }
    
    };

    def.$source = function() {
      var self = this;

      return self.source;
    };

    return $opal.defn(self, '$to_s', def.$source);
  })(self, null)
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/regexp.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $module = $opal.module;

  $opal.add_stubs(['$===', '$>', '$<', '$equal?', '$<=>', '$==', '$normalize', '$raise', '$class', '$>=', '$<=']);
  return (function($base) {
    var self = $module($base, 'Comparable');

    var def = self._proto, $scope = self._scope;

    $opal.defs(self, '$normalize', function(what) {
      var $a, $b, self = this;

      if ((($a = (($b = $scope.Integer) == null ? $opal.cm('Integer') : $b)['$==='](what)) !== nil && (!$a._isBoolean || $a == true))) {
        return what};
      if (what['$>'](0)) {
        return 1};
      if (what['$<'](0)) {
        return -1};
      return 0;
    });

    def['$=='] = function(other) {
      var $a, self = this, cmp = nil;

      try {
      if ((($a = self['$equal?'](other)) !== nil && (!$a._isBoolean || $a == true))) {
          return true};
        if ((($a = cmp = (self['$<=>'](other))) !== nil && (!$a._isBoolean || $a == true))) {
          } else {
          return false
        };
        return (($a = $scope.Comparable) == null ? $opal.cm('Comparable') : $a).$normalize(cmp)['$=='](0);
      } catch ($err) {if ($opal.$rescue($err, [(($a = $scope.StandardError) == null ? $opal.cm('StandardError') : $a)])) {
        return false
        }else { throw $err; }
      };
    };

    def['$>'] = function(other) {
      var $a, self = this, cmp = nil;

      if ((($a = cmp = (self['$<=>'](other))) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "comparison of " + (self.$class()) + " with " + (other.$class()) + " failed")
      };
      return (($a = $scope.Comparable) == null ? $opal.cm('Comparable') : $a).$normalize(cmp)['$>'](0);
    };

    def['$>='] = function(other) {
      var $a, self = this, cmp = nil;

      if ((($a = cmp = (self['$<=>'](other))) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "comparison of " + (self.$class()) + " with " + (other.$class()) + " failed")
      };
      return (($a = $scope.Comparable) == null ? $opal.cm('Comparable') : $a).$normalize(cmp)['$>='](0);
    };

    def['$<'] = function(other) {
      var $a, self = this, cmp = nil;

      if ((($a = cmp = (self['$<=>'](other))) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "comparison of " + (self.$class()) + " with " + (other.$class()) + " failed")
      };
      return (($a = $scope.Comparable) == null ? $opal.cm('Comparable') : $a).$normalize(cmp)['$<'](0);
    };

    def['$<='] = function(other) {
      var $a, self = this, cmp = nil;

      if ((($a = cmp = (self['$<=>'](other))) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "comparison of " + (self.$class()) + " with " + (other.$class()) + " failed")
      };
      return (($a = $scope.Comparable) == null ? $opal.cm('Comparable') : $a).$normalize(cmp)['$<='](0);
    };

    def['$between?'] = function(min, max) {
      var self = this;

      if (self['$<'](min)) {
        return false};
      if (self['$>'](max)) {
        return false};
      return true;
    };
        ;$opal.donate(self, ["$==", "$>", "$>=", "$<", "$<=", "$between?"]);
  })(self)
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/comparable.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $module = $opal.module;

  $opal.add_stubs(['$raise', '$enum_for', '$flatten', '$map', '$==', '$destructure', '$nil?', '$coerce_to!', '$coerce_to', '$===', '$new', '$<<', '$[]', '$[]=', '$inspect', '$__send__', '$yield', '$enumerator_size', '$respond_to?', '$size', '$private', '$compare', '$<=>', '$dup', '$sort', '$call', '$first', '$zip', '$to_a']);
  return (function($base) {
    var self = $module($base, 'Enumerable');

    var def = self._proto, $scope = self._scope, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5, TMP_7, TMP_8, TMP_9, TMP_10, TMP_11, TMP_12, TMP_13, TMP_14, TMP_15, TMP_16, TMP_17, TMP_18, TMP_19, TMP_20, TMP_22, TMP_23, TMP_24, TMP_25, TMP_26, TMP_27, TMP_28, TMP_29, TMP_30, TMP_31, TMP_32, TMP_33, TMP_35, TMP_36, TMP_40, TMP_41;

    def['$all?'] = TMP_1 = function() {
      var $a, self = this, $iter = TMP_1._p, block = $iter || nil;

      TMP_1._p = null;
      
      var result = true;

      if (block !== nil) {
        self.$each._p = function() {
          var value = $opal.$yieldX(block, arguments);

          if (value === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          if ((($a = value) === nil || ($a._isBoolean && $a == false))) {
            result = false;
            return $breaker;
          }
        }
      }
      else {
        self.$each._p = function(obj) {
          if (arguments.length == 1 && (($a = obj) === nil || ($a._isBoolean && $a == false))) {
            result = false;
            return $breaker;
          }
        }
      }

      self.$each();

      return result;
    
    };

    def['$any?'] = TMP_2 = function() {
      var $a, self = this, $iter = TMP_2._p, block = $iter || nil;

      TMP_2._p = null;
      
      var result = false;

      if (block !== nil) {
        self.$each._p = function() {
          var value = $opal.$yieldX(block, arguments);

          if (value === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          if ((($a = value) !== nil && (!$a._isBoolean || $a == true))) {
            result = true;
            return $breaker;
          }
        };
      }
      else {
        self.$each._p = function(obj) {
          if (arguments.length != 1 || (($a = obj) !== nil && (!$a._isBoolean || $a == true))) {
            result = true;
            return $breaker;
          }
        }
      }

      self.$each();

      return result;
    
    };

    def.$chunk = TMP_3 = function(state) {
      var $a, self = this, $iter = TMP_3._p, block = $iter || nil;

      TMP_3._p = null;
      return self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
    };

    def.$collect = TMP_4 = function() {
      var self = this, $iter = TMP_4._p, block = $iter || nil;

      TMP_4._p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("collect")
      };
      
      var result = [];

      self.$each._p = function() {
        var value = $opal.$yieldX(block, arguments);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        result.push(value);
      };

      self.$each();

      return result;
    
    };

    def.$collect_concat = TMP_5 = function() {
      var $a, $b, TMP_6, self = this, $iter = TMP_5._p, block = $iter || nil;

      TMP_5._p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("collect_concat")
      };
      return ($a = ($b = self).$map, $a._p = (TMP_6 = function(item){var self = TMP_6._s || this, $a;
if (item == null) item = nil;
      return $a = $opal.$yield1(block, item), $a === $breaker ? $a : $a}, TMP_6._s = self, TMP_6), $a).call($b).$flatten(1);
    };

    def.$count = TMP_7 = function(object) {
      var $a, self = this, $iter = TMP_7._p, block = $iter || nil;

      TMP_7._p = null;
      
      var result = 0;

      if (object != null) {
        block = function() {
          return (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments)['$=='](object);
        };
      }
      else if (block === nil) {
        block = function() { return true; };
      }

      self.$each._p = function() {
        var value = $opal.$yieldX(block, arguments);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        if ((($a = value) !== nil && (!$a._isBoolean || $a == true))) {
          result++;
        }
      }

      self.$each();

      return result;
    
    };

    def.$cycle = TMP_8 = function(n) {
      var $a, self = this, $iter = TMP_8._p, block = $iter || nil;

      if (n == null) {
        n = nil
      }
      TMP_8._p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("cycle", n)
      };
      if ((($a = n['$nil?']()) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        n = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a)['$coerce_to!'](n, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
        if ((($a = n <= 0) !== nil && (!$a._isBoolean || $a == true))) {
          return nil};
      };
      
      var result,
          all  = [];

      self.$each._p = function() {
        var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
            value = $opal.$yield1(block, param);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        all.push(param);
      }

      self.$each();

      if (result !== undefined) {
        return result;
      }

      if (all.length === 0) {
        return nil;
      }
    
      if ((($a = n['$nil?']()) !== nil && (!$a._isBoolean || $a == true))) {
        
        while (true) {
          for (var i = 0, length = all.length; i < length; i++) {
            var value = $opal.$yield1(block, all[i]);

            if (value === $breaker) {
              return $breaker.$v;
            }
          }
        }
      
        } else {
        
        while (n > 1) {
          for (var i = 0, length = all.length; i < length; i++) {
            var value = $opal.$yield1(block, all[i]);

            if (value === $breaker) {
              return $breaker.$v;
            }
          }

          n--;
        }
      
      };
    };

    def.$detect = TMP_9 = function(ifnone) {
      var $a, self = this, $iter = TMP_9._p, block = $iter || nil;

      TMP_9._p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("detect", ifnone)
      };
      
      var result = undefined;

      self.$each._p = function() {
        var params = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
            value  = $opal.$yield1(block, params);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        if ((($a = value) !== nil && (!$a._isBoolean || $a == true))) {
          result = params;
          return $breaker;
        }
      };

      self.$each();

      if (result === undefined && ifnone !== undefined) {
        if (typeof(ifnone) === 'function') {
          result = ifnone();
        }
        else {
          result = ifnone;
        }
      }

      return result === undefined ? nil : result;
    
    };

    def.$drop = function(number) {
      var $a, self = this;

      number = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(number, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
      if ((($a = number < 0) !== nil && (!$a._isBoolean || $a == true))) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "attempt to drop negative size")};
      
      var result  = [],
          current = 0;

      self.$each._p = function() {
        if (number <= current) {
          result.push((($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments));
        }

        current++;
      };

      self.$each()

      return result;
    
    };

    def.$drop_while = TMP_10 = function() {
      var $a, self = this, $iter = TMP_10._p, block = $iter || nil;

      TMP_10._p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("drop_while")
      };
      
      var result   = [],
          dropping = true;

      self.$each._p = function() {
        var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);

        if (dropping) {
          var value = $opal.$yield1(block, param);

          if (value === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          if ((($a = value) === nil || ($a._isBoolean && $a == false))) {
            dropping = false;
            result.push(param);
          }
        }
        else {
          result.push(param);
        }
      };

      self.$each();

      return result;
    
    };

    def.$each_cons = TMP_11 = function(n) {
      var $a, self = this, $iter = TMP_11._p, block = $iter || nil;

      TMP_11._p = null;
      return self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
    };

    def.$each_entry = TMP_12 = function() {
      var $a, self = this, $iter = TMP_12._p, block = $iter || nil;

      TMP_12._p = null;
      return self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
    };

    def.$each_slice = TMP_13 = function(n) {
      var $a, self = this, $iter = TMP_13._p, block = $iter || nil;

      TMP_13._p = null;
      n = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(n, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
      if ((($a = n <= 0) !== nil && (!$a._isBoolean || $a == true))) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "invalid slice size")};
      if ((block !== nil)) {
        } else {
        return self.$enum_for("each_slice", n)
      };
      
      var result,
          slice = []

      self.$each._p = function() {
        var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);

        slice.push(param);

        if (slice.length === n) {
          if ($opal.$yield1(block, slice) === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          slice = [];
        }
      };

      self.$each();

      if (result !== undefined) {
        return result;
      }

      // our "last" group, if smaller than n then won't have been yielded
      if (slice.length > 0) {
        if ($opal.$yield1(block, slice) === $breaker) {
          return $breaker.$v;
        }
      }
    ;
      return nil;
    };

    def.$each_with_index = TMP_14 = function(args) {
      var $a, $b, self = this, $iter = TMP_14._p, block = $iter || nil;

      args = $slice.call(arguments, 0);
      TMP_14._p = null;
      if ((block !== nil)) {
        } else {
        return ($a = self).$enum_for.apply($a, ["each_with_index"].concat(args))
      };
      
      var result,
          index = 0;

      self.$each._p = function() {
        var param = (($b = $scope.Opal) == null ? $opal.cm('Opal') : $b).$destructure(arguments),
            value = block(param, index);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        index++;
      };

      self.$each.apply(self, args);

      if (result !== undefined) {
        return result;
      }
    
      return self;
    };

    def.$each_with_object = TMP_15 = function(object) {
      var $a, self = this, $iter = TMP_15._p, block = $iter || nil;

      TMP_15._p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("each_with_object", object)
      };
      
      var result;

      self.$each._p = function() {
        var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
            value = block(param, object);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }
      };

      self.$each();

      if (result !== undefined) {
        return result;
      }
    
      return object;
    };

    def.$entries = function(args) {
      var $a, self = this;

      args = $slice.call(arguments, 0);
      
      var result = [];

      self.$each._p = function() {
        result.push((($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments));
      };

      self.$each.apply(self, args);

      return result;
    
    };

    $opal.defn(self, '$find', def.$detect);

    def.$find_all = TMP_16 = function() {
      var $a, self = this, $iter = TMP_16._p, block = $iter || nil;

      TMP_16._p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("find_all")
      };
      
      var result = [];

      self.$each._p = function() {
        var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
            value = $opal.$yield1(block, param);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        if ((($a = value) !== nil && (!$a._isBoolean || $a == true))) {
          result.push(param);
        }
      };

      self.$each();

      return result;
    
    };

    def.$find_index = TMP_17 = function(object) {
      var $a, self = this, $iter = TMP_17._p, block = $iter || nil;

      TMP_17._p = null;
      if ((($a = object === undefined && block === nil) !== nil && (!$a._isBoolean || $a == true))) {
        return self.$enum_for("find_index")};
      
      var result = nil,
          index  = 0;

      if (object != null) {
        self.$each._p = function() {
          var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);

          if ((param)['$=='](object)) {
            result = index;
            return $breaker;
          }

          index += 1;
        };
      }
      else if (block !== nil) {
        self.$each._p = function() {
          var value = $opal.$yieldX(block, arguments);

          if (value === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          if ((($a = value) !== nil && (!$a._isBoolean || $a == true))) {
            result = index;
            return $breaker;
          }

          index += 1;
        };
      }

      self.$each();

      return result;
    
    };

    def.$first = function(number) {
      var $a, self = this, result = nil;

      if ((($a = number === undefined) !== nil && (!$a._isBoolean || $a == true))) {
        result = nil;
        
        self.$each._p = function() {
          result = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);

          return $breaker;
        };

        self.$each();
      ;
        } else {
        result = [];
        number = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(number, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
        if ((($a = number < 0) !== nil && (!$a._isBoolean || $a == true))) {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "attempt to take negative size")};
        if ((($a = number == 0) !== nil && (!$a._isBoolean || $a == true))) {
          return []};
        
        var current = 0,
            number  = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(number, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");

        self.$each._p = function() {
          result.push((($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments));

          if (number <= ++current) {
            return $breaker;
          }
        };

        self.$each();
      ;
      };
      return result;
    };

    $opal.defn(self, '$flat_map', def.$collect_concat);

    def.$grep = TMP_18 = function(pattern) {
      var $a, self = this, $iter = TMP_18._p, block = $iter || nil;

      TMP_18._p = null;
      
      var result = [];

      if (block !== nil) {
        self.$each._p = function() {
          var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
              value = pattern['$==='](param);

          if ((($a = value) !== nil && (!$a._isBoolean || $a == true))) {
            value = $opal.$yield1(block, param);

            if (value === $breaker) {
              result = $breaker.$v;
              return $breaker;
            }

            result.push(value);
          }
        };
      }
      else {
        self.$each._p = function() {
          var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
              value = pattern['$==='](param);

          if ((($a = value) !== nil && (!$a._isBoolean || $a == true))) {
            result.push(param);
          }
        };
      }

      self.$each();

      return result;
    ;
    };

    def.$group_by = TMP_19 = function() {
      var $a, $b, $c, self = this, $iter = TMP_19._p, block = $iter || nil, hash = nil;

      TMP_19._p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("group_by")
      };
      hash = (($a = $scope.Hash) == null ? $opal.cm('Hash') : $a).$new();
      
      var result;

      self.$each._p = function() {
        var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
            value = $opal.$yield1(block, param);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        (($a = value, $b = hash, ((($c = $b['$[]']($a)) !== false && $c !== nil) ? $c : $b['$[]=']($a, []))))['$<<'](param);
      }

      self.$each();

      if (result !== undefined) {
        return result;
      }
    
      return hash;
    };

    def['$include?'] = function(obj) {
      var $a, self = this;

      
      var result = false;

      self.$each._p = function() {
        var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);

        if ((param)['$=='](obj)) {
          result = true;
          return $breaker;
        }
      }

      self.$each();

      return result;
    
    };

    def.$inject = TMP_20 = function(object, sym) {
      var $a, self = this, $iter = TMP_20._p, block = $iter || nil;

      TMP_20._p = null;
      
      var result = object;

      if (block !== nil && sym === undefined) {
        self.$each._p = function() {
          var value = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);

          if (result === undefined) {
            result = value;
            return;
          }

          value = $opal.$yieldX(block, [result, value]);

          if (value === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          result = value;
        };
      }
      else {
        if (sym === undefined) {
          if (!(($a = $scope.Symbol) == null ? $opal.cm('Symbol') : $a)['$==='](object)) {
            self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "" + (object.$inspect()) + " is not a Symbol");
          }

          sym    = object;
          result = undefined;
        }

        self.$each._p = function() {
          var value = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);

          if (result === undefined) {
            result = value;
            return;
          }

          result = (result).$__send__(sym, value);
        };
      }

      self.$each();

      return result == undefined ? nil : result;
    ;
    };

    def.$lazy = function() {
      var $a, $b, TMP_21, $c, $d, self = this;

      return ($a = ($b = (($c = ((($d = $scope.Enumerator) == null ? $opal.cm('Enumerator') : $d))._scope).Lazy == null ? $c.cm('Lazy') : $c.Lazy)).$new, $a._p = (TMP_21 = function(enum$, args){var self = TMP_21._s || this, $a;
if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
      return ($a = enum$).$yield.apply($a, [].concat(args))}, TMP_21._s = self, TMP_21), $a).call($b, self, self.$enumerator_size());
    };

    def.$enumerator_size = function() {
      var $a, self = this;

      if ((($a = self['$respond_to?']("size")) !== nil && (!$a._isBoolean || $a == true))) {
        return self.$size()
        } else {
        return nil
      };
    };

    self.$private("enumerator_size");

    $opal.defn(self, '$map', def.$collect);

    def.$max = TMP_22 = function() {
      var $a, self = this, $iter = TMP_22._p, block = $iter || nil;

      TMP_22._p = null;
      
      var result;

      if (block !== nil) {
        self.$each._p = function() {
          var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);

          if (result === undefined) {
            result = param;
            return;
          }

          var value = block(param, result);

          if (value === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          if (value === nil) {
            self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "comparison failed");
          }

          if (value > 0) {
            result = param;
          }
        };
      }
      else {
        self.$each._p = function() {
          var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);

          if (result === undefined) {
            result = param;
            return;
          }

          if ((($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$compare(param, result) > 0) {
            result = param;
          }
        };
      }

      self.$each();

      return result === undefined ? nil : result;
    
    };

    def.$max_by = TMP_23 = function() {
      var $a, self = this, $iter = TMP_23._p, block = $iter || nil;

      TMP_23._p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("max_by")
      };
      
      var result,
          by;

      self.$each._p = function() {
        var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
            value = $opal.$yield1(block, param);

        if (result === undefined) {
          result = param;
          by     = value;
          return;
        }

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        if ((value)['$<=>'](by) > 0) {
          result = param
          by     = value;
        }
      };

      self.$each();

      return result === undefined ? nil : result;
    
    };

    $opal.defn(self, '$member?', def['$include?']);

    def.$min = TMP_24 = function() {
      var $a, self = this, $iter = TMP_24._p, block = $iter || nil;

      TMP_24._p = null;
      
      var result;

      if (block !== nil) {
        self.$each._p = function() {
          var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);

          if (result === undefined) {
            result = param;
            return;
          }

          var value = block(param, result);

          if (value === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          if (value === nil) {
            self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "comparison failed");
          }

          if (value < 0) {
            result = param;
          }
        };
      }
      else {
        self.$each._p = function() {
          var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);

          if (result === undefined) {
            result = param;
            return;
          }

          if ((($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$compare(param, result) < 0) {
            result = param;
          }
        };
      }

      self.$each();

      return result === undefined ? nil : result;
    
    };

    def.$min_by = TMP_25 = function() {
      var $a, self = this, $iter = TMP_25._p, block = $iter || nil;

      TMP_25._p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("min_by")
      };
      
      var result,
          by;

      self.$each._p = function() {
        var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
            value = $opal.$yield1(block, param);

        if (result === undefined) {
          result = param;
          by     = value;
          return;
        }

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        if ((value)['$<=>'](by) < 0) {
          result = param
          by     = value;
        }
      };

      self.$each();

      return result === undefined ? nil : result;
    
    };

    def.$minmax = TMP_26 = function() {
      var $a, self = this, $iter = TMP_26._p, block = $iter || nil;

      TMP_26._p = null;
      return self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
    };

    def.$minmax_by = TMP_27 = function() {
      var $a, self = this, $iter = TMP_27._p, block = $iter || nil;

      TMP_27._p = null;
      return self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
    };

    def['$none?'] = TMP_28 = function() {
      var $a, self = this, $iter = TMP_28._p, block = $iter || nil;

      TMP_28._p = null;
      
      var result = true;

      if (block !== nil) {
        self.$each._p = function() {
          var value = $opal.$yieldX(block, arguments);

          if (value === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          if ((($a = value) !== nil && (!$a._isBoolean || $a == true))) {
            result = false;
            return $breaker;
          }
        }
      }
      else {
        self.$each._p = function() {
          var value = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);

          if ((($a = value) !== nil && (!$a._isBoolean || $a == true))) {
            result = false;
            return $breaker;
          }
        };
      }

      self.$each();

      return result;
    
    };

    def['$one?'] = TMP_29 = function() {
      var $a, self = this, $iter = TMP_29._p, block = $iter || nil;

      TMP_29._p = null;
      
      var result = false;

      if (block !== nil) {
        self.$each._p = function() {
          var value = $opal.$yieldX(block, arguments);

          if (value === $breaker) {
            result = $breaker.$v;
            return $breaker;
          }

          if ((($a = value) !== nil && (!$a._isBoolean || $a == true))) {
            if (result === true) {
              result = false;
              return $breaker;
            }

            result = true;
          }
        }
      }
      else {
        self.$each._p = function() {
          var value = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);

          if ((($a = value) !== nil && (!$a._isBoolean || $a == true))) {
            if (result === true) {
              result = false;
              return $breaker;
            }

            result = true;
          }
        }
      }

      self.$each();

      return result;
    
    };

    def.$partition = TMP_30 = function() {
      var $a, self = this, $iter = TMP_30._p, block = $iter || nil;

      TMP_30._p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("partition")
      };
      
      var truthy = [], falsy = [];

      self.$each._p = function() {
        var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
            value = $opal.$yield1(block, param);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        if ((($a = value) !== nil && (!$a._isBoolean || $a == true))) {
          truthy.push(param);
        }
        else {
          falsy.push(param);
        }
      };

      self.$each();

      return [truthy, falsy];
    
    };

    $opal.defn(self, '$reduce', def.$inject);

    def.$reject = TMP_31 = function() {
      var $a, self = this, $iter = TMP_31._p, block = $iter || nil;

      TMP_31._p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("reject")
      };
      
      var result = [];

      self.$each._p = function() {
        var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
            value = $opal.$yield1(block, param);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        if ((($a = value) === nil || ($a._isBoolean && $a == false))) {
          result.push(param);
        }
      };

      self.$each();

      return result;
    
    };

    def.$reverse_each = TMP_32 = function() {
      var self = this, $iter = TMP_32._p, block = $iter || nil;

      TMP_32._p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("reverse_each")
      };
      
      var result = [];

      self.$each._p = function() {
        result.push(arguments);
      };

      self.$each();

      for (var i = result.length - 1; i >= 0; i--) {
        $opal.$yieldX(block, result[i]);
      }

      return result;
    
    };

    $opal.defn(self, '$select', def.$find_all);

    def.$slice_before = TMP_33 = function(pattern) {
      var $a, $b, TMP_34, $c, self = this, $iter = TMP_33._p, block = $iter || nil;

      TMP_33._p = null;
      if ((($a = pattern === undefined && block === nil || arguments.length > 1) !== nil && (!$a._isBoolean || $a == true))) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "wrong number of arguments (" + (arguments.length) + " for 1)")};
      return ($a = ($b = (($c = $scope.Enumerator) == null ? $opal.cm('Enumerator') : $c)).$new, $a._p = (TMP_34 = function(e){var self = TMP_34._s || this, $a;
if (e == null) e = nil;
      
        var slice = [];

        if (block !== nil) {
          if (pattern === undefined) {
            self.$each._p = function() {
              var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
                  value = $opal.$yield1(block, param);

              if ((($a = value) !== nil && (!$a._isBoolean || $a == true)) && slice.length > 0) {
                e['$<<'](slice);
                slice = [];
              }

              slice.push(param);
            };
          }
          else {
            self.$each._p = function() {
              var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
                  value = block(param, pattern.$dup());

              if ((($a = value) !== nil && (!$a._isBoolean || $a == true)) && slice.length > 0) {
                e['$<<'](slice);
                slice = [];
              }

              slice.push(param);
            };
          }
        }
        else {
          self.$each._p = function() {
            var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
                value = pattern['$==='](param);

            if ((($a = value) !== nil && (!$a._isBoolean || $a == true)) && slice.length > 0) {
              e['$<<'](slice);
              slice = [];
            }

            slice.push(param);
          };
        }

        self.$each();

        if (slice.length > 0) {
          e['$<<'](slice);
        }
      ;}, TMP_34._s = self, TMP_34), $a).call($b);
    };

    def.$sort = TMP_35 = function() {
      var $a, self = this, $iter = TMP_35._p, block = $iter || nil;

      TMP_35._p = null;
      return self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
    };

    def.$sort_by = TMP_36 = function() {
      var $a, $b, TMP_37, $c, $d, TMP_38, $e, $f, TMP_39, self = this, $iter = TMP_36._p, block = $iter || nil;

      TMP_36._p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("sort_by")
      };
      return ($a = ($b = ($c = ($d = ($e = ($f = self).$map, $e._p = (TMP_39 = function(){var self = TMP_39._s || this, $a;

      arg = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments);
        return [block.$call(arg), arg];}, TMP_39._s = self, TMP_39), $e).call($f)).$sort, $c._p = (TMP_38 = function(a, b){var self = TMP_38._s || this;
if (a == null) a = nil;if (b == null) b = nil;
      return a['$[]'](0)['$<=>'](b['$[]'](0))}, TMP_38._s = self, TMP_38), $c).call($d)).$map, $a._p = (TMP_37 = function(arg){var self = TMP_37._s || this;
if (arg == null) arg = nil;
      return arg[1];}, TMP_37._s = self, TMP_37), $a).call($b);
    };

    def.$take = function(num) {
      var self = this;

      return self.$first(num);
    };

    def.$take_while = TMP_40 = function() {
      var $a, self = this, $iter = TMP_40._p, block = $iter || nil;

      TMP_40._p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("take_while")
      };
      
      var result = [];

      self.$each._p = function() {
        var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
            value = $opal.$yield1(block, param);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        if ((($a = value) === nil || ($a._isBoolean && $a == false))) {
          return $breaker;
        }

        result.push(param);
      };

      self.$each();

      return result;
    
    };

    $opal.defn(self, '$to_a', def.$entries);

    def.$zip = TMP_41 = function(others) {
      var $a, self = this, $iter = TMP_41._p, block = $iter || nil;

      others = $slice.call(arguments, 0);
      TMP_41._p = null;
      return ($a = self.$to_a()).$zip.apply($a, [].concat(others));
    };
        ;$opal.donate(self, ["$all?", "$any?", "$chunk", "$collect", "$collect_concat", "$count", "$cycle", "$detect", "$drop", "$drop_while", "$each_cons", "$each_entry", "$each_slice", "$each_with_index", "$each_with_object", "$entries", "$find", "$find_all", "$find_index", "$first", "$flat_map", "$grep", "$group_by", "$include?", "$inject", "$lazy", "$enumerator_size", "$map", "$max", "$max_by", "$member?", "$min", "$min_by", "$minmax", "$minmax_by", "$none?", "$one?", "$partition", "$reduce", "$reject", "$reverse_each", "$select", "$slice_before", "$sort", "$sort_by", "$take", "$take_while", "$to_a", "$zip"]);
  })(self)
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/enumerable.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;

  $opal.add_stubs(['$include', '$allocate', '$new', '$to_proc', '$coerce_to', '$nil?', '$empty?', '$+', '$class', '$__send__', '$===', '$call', '$enum_for', '$destructure', '$name', '$inspect', '$[]', '$raise', '$yield', '$each', '$enumerator_size', '$respond_to?', '$try_convert', '$<', '$for']);
  ;
  return (function($base, $super) {
    function $Enumerator(){};
    var self = $Enumerator = $klass($base, $super, 'Enumerator', $Enumerator);

    var def = self._proto, $scope = self._scope, $a, TMP_1, TMP_2, TMP_3, TMP_4;

    def.size = def.args = def.object = def.method = nil;
    self.$include((($a = $scope.Enumerable) == null ? $opal.cm('Enumerable') : $a));

    $opal.defs(self, '$for', TMP_1 = function(object, method, args) {
      var self = this, $iter = TMP_1._p, block = $iter || nil;

      args = $slice.call(arguments, 2);
      if (method == null) {
        method = "each"
      }
      TMP_1._p = null;
      
      var obj = self.$allocate();

      obj.object = object;
      obj.size   = block;
      obj.method = method;
      obj.args   = args;

      return obj;
    ;
    });

    def.$initialize = TMP_2 = function() {
      var $a, $b, $c, self = this, $iter = TMP_2._p, block = $iter || nil;

      TMP_2._p = null;
      if (block !== false && block !== nil) {
        self.object = ($a = ($b = (($c = $scope.Generator) == null ? $opal.cm('Generator') : $c)).$new, $a._p = block.$to_proc(), $a).call($b);
        self.method = "each";
        self.args = [];
        self.size = arguments[0] || nil;
        if ((($a = self.size) !== nil && (!$a._isBoolean || $a == true))) {
          return self.size = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(self.size, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int")
          } else {
          return nil
        };
        } else {
        self.object = arguments[0];
        self.method = arguments[1] || "each";
        self.args = $slice.call(arguments, 2);
        return self.size = nil;
      };
    };

    def.$each = TMP_3 = function(args) {
      var $a, $b, $c, self = this, $iter = TMP_3._p, block = $iter || nil;

      args = $slice.call(arguments, 0);
      TMP_3._p = null;
      if ((($a = ($b = block['$nil?'](), $b !== false && $b !== nil ?args['$empty?']() : $b)) !== nil && (!$a._isBoolean || $a == true))) {
        return self};
      args = self.args['$+'](args);
      if ((($a = block['$nil?']()) !== nil && (!$a._isBoolean || $a == true))) {
        return ($a = self.$class()).$new.apply($a, [self.object, self.method].concat(args))};
      return ($b = ($c = self.object).$__send__, $b._p = block.$to_proc(), $b).apply($c, [self.method].concat(args));
    };

    def.$size = function() {
      var $a, $b, self = this;

      if ((($a = (($b = $scope.Proc) == null ? $opal.cm('Proc') : $b)['$==='](self.size)) !== nil && (!$a._isBoolean || $a == true))) {
        return ($a = self.size).$call.apply($a, [].concat(self.args))
        } else {
        return self.size
      };
    };

    def.$with_index = TMP_4 = function(offset) {
      var $a, self = this, $iter = TMP_4._p, block = $iter || nil;

      if (offset == null) {
        offset = 0
      }
      TMP_4._p = null;
      if (offset !== false && offset !== nil) {
        offset = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(offset, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int")
        } else {
        offset = 0
      };
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("with_index", offset)
      };
      
      var result

      self.$each._p = function() {
        var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(arguments),
            value = block(param, index);

        if (value === $breaker) {
          result = $breaker.$v;
          return $breaker;
        }

        index++;
      }

      self.$each();

      if (result !== undefined) {
        return result;
      }
    ;
    };

    $opal.defn(self, '$with_object', def.$each_with_object);

    def.$inspect = function() {
      var $a, self = this, result = nil;

      result = "#<" + (self.$class().$name()) + ": " + (self.object.$inspect()) + ":" + (self.method);
      if ((($a = self.args['$empty?']()) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        result = result['$+']("(" + (self.args.$inspect()['$[]']((($a = $scope.Range) == null ? $opal.cm('Range') : $a).$new(1, -2))) + ")")
      };
      return result['$+'](">");
    };

    (function($base, $super) {
      function $Generator(){};
      var self = $Generator = $klass($base, $super, 'Generator', $Generator);

      var def = self._proto, $scope = self._scope, $a, TMP_5, TMP_6;

      def.block = nil;
      self.$include((($a = $scope.Enumerable) == null ? $opal.cm('Enumerable') : $a));

      def.$initialize = TMP_5 = function() {
        var $a, self = this, $iter = TMP_5._p, block = $iter || nil;

        TMP_5._p = null;
        if (block !== false && block !== nil) {
          } else {
          self.$raise((($a = $scope.LocalJumpError) == null ? $opal.cm('LocalJumpError') : $a), "no block given")
        };
        return self.block = block;
      };

      return (def.$each = TMP_6 = function(args) {
        var $a, $b, $c, self = this, $iter = TMP_6._p, block = $iter || nil, yielder = nil;

        args = $slice.call(arguments, 0);
        TMP_6._p = null;
        yielder = ($a = ($b = (($c = $scope.Yielder) == null ? $opal.cm('Yielder') : $c)).$new, $a._p = block.$to_proc(), $a).call($b);
        
        try {
          args.unshift(yielder);

          if ($opal.$yieldX(self.block, args) === $breaker) {
            return $breaker.$v;
          }
        }
        catch (e) {
          if (e === $breaker) {
            return $breaker.$v;
          }
          else {
            throw e;
          }
        }
      ;
        return self;
      }, nil) && 'each';
    })(self, null);

    (function($base, $super) {
      function $Yielder(){};
      var self = $Yielder = $klass($base, $super, 'Yielder', $Yielder);

      var def = self._proto, $scope = self._scope, TMP_7;

      def.block = nil;
      def.$initialize = TMP_7 = function() {
        var self = this, $iter = TMP_7._p, block = $iter || nil;

        TMP_7._p = null;
        return self.block = block;
      };

      def.$yield = function(values) {
        var self = this;

        values = $slice.call(arguments, 0);
        
        var value = $opal.$yieldX(self.block, values);

        if (value === $breaker) {
          throw $breaker;
        }

        return value;
      ;
      };

      return (def['$<<'] = function(values) {
        var $a, self = this;

        values = $slice.call(arguments, 0);
        ($a = self).$yield.apply($a, [].concat(values));
        return self;
      }, nil) && '<<';
    })(self, null);

    return (function($base, $super) {
      function $Lazy(){};
      var self = $Lazy = $klass($base, $super, 'Lazy', $Lazy);

      var def = self._proto, $scope = self._scope, $a, TMP_8, TMP_11, TMP_13, TMP_18, TMP_20, TMP_21, TMP_23, TMP_26, TMP_29;

      def.enumerator = nil;
      (function($base, $super) {
        function $StopLazyError(){};
        var self = $StopLazyError = $klass($base, $super, 'StopLazyError', $StopLazyError);

        var def = self._proto, $scope = self._scope;

        return nil;
      })(self, (($a = $scope.Exception) == null ? $opal.cm('Exception') : $a));

      def.$initialize = TMP_8 = function(object, size) {
        var $a, TMP_9, self = this, $iter = TMP_8._p, block = $iter || nil;

        if (size == null) {
          size = nil
        }
        TMP_8._p = null;
        if ((block !== nil)) {
          } else {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "tried to call lazy new without a block")
        };
        self.enumerator = object;
        return $opal.find_super_dispatcher(self, 'initialize', TMP_8, (TMP_9 = function(yielder, each_args){var self = TMP_9._s || this, $a, $b, TMP_10;
if (yielder == null) yielder = nil;each_args = $slice.call(arguments, 1);
        try {
          return ($a = ($b = object).$each, $a._p = (TMP_10 = function(args){var self = TMP_10._s || this;
args = $slice.call(arguments, 0);
            
              args.unshift(yielder);

              if ($opal.$yieldX(block, args) === $breaker) {
                return $breaker;
              }
            ;}, TMP_10._s = self, TMP_10), $a).apply($b, [].concat(each_args))
          } catch ($err) {if ($opal.$rescue($err, [(($a = $scope.Exception) == null ? $opal.cm('Exception') : $a)])) {
            return nil
            }else { throw $err; }
          }}, TMP_9._s = self, TMP_9)).apply(self, [size]);
      };

      $opal.defn(self, '$force', def.$to_a);

      def.$lazy = function() {
        var self = this;

        return self;
      };

      def.$collect = TMP_11 = function() {
        var $a, $b, TMP_12, $c, self = this, $iter = TMP_11._p, block = $iter || nil;

        TMP_11._p = null;
        if (block !== false && block !== nil) {
          } else {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "tried to call lazy map without a block")
        };
        return ($a = ($b = (($c = $scope.Lazy) == null ? $opal.cm('Lazy') : $c)).$new, $a._p = (TMP_12 = function(enum$, args){var self = TMP_12._s || this;
if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
        
          var value = $opal.$yieldX(block, args);

          if (value === $breaker) {
            return $breaker;
          }

          enum$.$yield(value);
        }, TMP_12._s = self, TMP_12), $a).call($b, self, self.$enumerator_size());
      };

      def.$collect_concat = TMP_13 = function() {
        var $a, $b, TMP_14, $c, self = this, $iter = TMP_13._p, block = $iter || nil;

        TMP_13._p = null;
        if (block !== false && block !== nil) {
          } else {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "tried to call lazy map without a block")
        };
        return ($a = ($b = (($c = $scope.Lazy) == null ? $opal.cm('Lazy') : $c)).$new, $a._p = (TMP_14 = function(enum$, args){var self = TMP_14._s || this, $a, $b, TMP_15, $c, TMP_16;
if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
        
          var value = $opal.$yieldX(block, args);

          if (value === $breaker) {
            return $breaker;
          }

          if ((value)['$respond_to?']("force") && (value)['$respond_to?']("each")) {
            ($a = ($b = (value)).$each, $a._p = (TMP_15 = function(v){var self = TMP_15._s || this;
if (v == null) v = nil;
          return enum$.$yield(v)}, TMP_15._s = self, TMP_15), $a).call($b)
          }
          else {
            var array = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$try_convert(value, (($a = $scope.Array) == null ? $opal.cm('Array') : $a), "to_ary");

            if (array === nil) {
              enum$.$yield(value);
            }
            else {
              ($a = ($c = (value)).$each, $a._p = (TMP_16 = function(v){var self = TMP_16._s || this;
if (v == null) v = nil;
          return enum$.$yield(v)}, TMP_16._s = self, TMP_16), $a).call($c);
            }
          }
        ;}, TMP_14._s = self, TMP_14), $a).call($b, self, nil);
      };

      def.$drop = function(n) {
        var $a, $b, TMP_17, $c, self = this, current_size = nil, set_size = nil, dropped = nil;

        n = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(n, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
        if (n['$<'](0)) {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "attempt to drop negative size")};
        current_size = self.$enumerator_size();
        set_size = (function() {if ((($a = (($b = $scope.Integer) == null ? $opal.cm('Integer') : $b)['$==='](current_size)) !== nil && (!$a._isBoolean || $a == true))) {
          if (n['$<'](current_size)) {
            return n
            } else {
            return current_size
          }
          } else {
          return current_size
        }; return nil; })();
        dropped = 0;
        return ($a = ($b = (($c = $scope.Lazy) == null ? $opal.cm('Lazy') : $c)).$new, $a._p = (TMP_17 = function(enum$, args){var self = TMP_17._s || this, $a;
if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
        if (dropped['$<'](n)) {
            return dropped = dropped['$+'](1)
            } else {
            return ($a = enum$).$yield.apply($a, [].concat(args))
          }}, TMP_17._s = self, TMP_17), $a).call($b, self, set_size);
      };

      def.$drop_while = TMP_18 = function() {
        var $a, $b, TMP_19, $c, self = this, $iter = TMP_18._p, block = $iter || nil, succeeding = nil;

        TMP_18._p = null;
        if (block !== false && block !== nil) {
          } else {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "tried to call lazy drop_while without a block")
        };
        succeeding = true;
        return ($a = ($b = (($c = $scope.Lazy) == null ? $opal.cm('Lazy') : $c)).$new, $a._p = (TMP_19 = function(enum$, args){var self = TMP_19._s || this, $a, $b;
if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
        if (succeeding !== false && succeeding !== nil) {
            
            var value = $opal.$yieldX(block, args);

            if (value === $breaker) {
              return $breaker;
            }

            if ((($a = value) === nil || ($a._isBoolean && $a == false))) {
              succeeding = false;

              ($a = enum$).$yield.apply($a, [].concat(args));
            }
          
            } else {
            return ($b = enum$).$yield.apply($b, [].concat(args))
          }}, TMP_19._s = self, TMP_19), $a).call($b, self, nil);
      };

      def.$enum_for = TMP_20 = function(method, args) {
        var $a, $b, self = this, $iter = TMP_20._p, block = $iter || nil;

        args = $slice.call(arguments, 1);
        if (method == null) {
          method = "each"
        }
        TMP_20._p = null;
        return ($a = ($b = self.$class()).$for, $a._p = block.$to_proc(), $a).apply($b, [self, method].concat(args));
      };

      def.$find_all = TMP_21 = function() {
        var $a, $b, TMP_22, $c, self = this, $iter = TMP_21._p, block = $iter || nil;

        TMP_21._p = null;
        if (block !== false && block !== nil) {
          } else {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "tried to call lazy select without a block")
        };
        return ($a = ($b = (($c = $scope.Lazy) == null ? $opal.cm('Lazy') : $c)).$new, $a._p = (TMP_22 = function(enum$, args){var self = TMP_22._s || this, $a;
if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
        
          var value = $opal.$yieldX(block, args);

          if (value === $breaker) {
            return $breaker;
          }

          if ((($a = value) !== nil && (!$a._isBoolean || $a == true))) {
            ($a = enum$).$yield.apply($a, [].concat(args));
          }
        ;}, TMP_22._s = self, TMP_22), $a).call($b, self, nil);
      };

      $opal.defn(self, '$flat_map', def.$collect_concat);

      def.$grep = TMP_23 = function(pattern) {
        var $a, $b, TMP_24, $c, TMP_25, $d, self = this, $iter = TMP_23._p, block = $iter || nil;

        TMP_23._p = null;
        if (block !== false && block !== nil) {
          return ($a = ($b = (($c = $scope.Lazy) == null ? $opal.cm('Lazy') : $c)).$new, $a._p = (TMP_24 = function(enum$, args){var self = TMP_24._s || this, $a;
if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
          
            var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(args),
                value = pattern['$==='](param);

            if ((($a = value) !== nil && (!$a._isBoolean || $a == true))) {
              value = $opal.$yield1(block, param);

              if (value === $breaker) {
                return $breaker;
              }

              enum$.$yield($opal.$yield1(block, param));
            }
          ;}, TMP_24._s = self, TMP_24), $a).call($b, self, nil)
          } else {
          return ($a = ($c = (($d = $scope.Lazy) == null ? $opal.cm('Lazy') : $d)).$new, $a._p = (TMP_25 = function(enum$, args){var self = TMP_25._s || this, $a;
if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
          
            var param = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$destructure(args),
                value = pattern['$==='](param);

            if ((($a = value) !== nil && (!$a._isBoolean || $a == true))) {
              enum$.$yield(param);
            }
          ;}, TMP_25._s = self, TMP_25), $a).call($c, self, nil)
        };
      };

      $opal.defn(self, '$map', def.$collect);

      $opal.defn(self, '$select', def.$find_all);

      def.$reject = TMP_26 = function() {
        var $a, $b, TMP_27, $c, self = this, $iter = TMP_26._p, block = $iter || nil;

        TMP_26._p = null;
        if (block !== false && block !== nil) {
          } else {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "tried to call lazy reject without a block")
        };
        return ($a = ($b = (($c = $scope.Lazy) == null ? $opal.cm('Lazy') : $c)).$new, $a._p = (TMP_27 = function(enum$, args){var self = TMP_27._s || this, $a;
if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
        
          var value = $opal.$yieldX(block, args);

          if (value === $breaker) {
            return $breaker;
          }

          if ((($a = value) === nil || ($a._isBoolean && $a == false))) {
            ($a = enum$).$yield.apply($a, [].concat(args));
          }
        ;}, TMP_27._s = self, TMP_27), $a).call($b, self, nil);
      };

      def.$take = function(n) {
        var $a, $b, TMP_28, $c, self = this, current_size = nil, set_size = nil, taken = nil;

        n = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(n, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
        if (n['$<'](0)) {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "attempt to take negative size")};
        current_size = self.$enumerator_size();
        set_size = (function() {if ((($a = (($b = $scope.Integer) == null ? $opal.cm('Integer') : $b)['$==='](current_size)) !== nil && (!$a._isBoolean || $a == true))) {
          if (n['$<'](current_size)) {
            return n
            } else {
            return current_size
          }
          } else {
          return current_size
        }; return nil; })();
        taken = 0;
        return ($a = ($b = (($c = $scope.Lazy) == null ? $opal.cm('Lazy') : $c)).$new, $a._p = (TMP_28 = function(enum$, args){var self = TMP_28._s || this, $a, $b;
if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
        if (taken['$<'](n)) {
            ($a = enum$).$yield.apply($a, [].concat(args));
            return taken = taken['$+'](1);
            } else {
            return self.$raise((($b = $scope.StopLazyError) == null ? $opal.cm('StopLazyError') : $b))
          }}, TMP_28._s = self, TMP_28), $a).call($b, self, set_size);
      };

      def.$take_while = TMP_29 = function() {
        var $a, $b, TMP_30, $c, self = this, $iter = TMP_29._p, block = $iter || nil;

        TMP_29._p = null;
        if (block !== false && block !== nil) {
          } else {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "tried to call lazy take_while without a block")
        };
        return ($a = ($b = (($c = $scope.Lazy) == null ? $opal.cm('Lazy') : $c)).$new, $a._p = (TMP_30 = function(enum$, args){var self = TMP_30._s || this, $a, $b;
if (enum$ == null) enum$ = nil;args = $slice.call(arguments, 1);
        
          var value = $opal.$yieldX(block, args);

          if (value === $breaker) {
            return $breaker;
          }

          if ((($a = value) !== nil && (!$a._isBoolean || $a == true))) {
            ($a = enum$).$yield.apply($a, [].concat(args));
          }
          else {
            self.$raise((($b = $scope.StopLazyError) == null ? $opal.cm('StopLazyError') : $b));
          }
        ;}, TMP_30._s = self, TMP_30), $a).call($b, self, nil);
      };

      $opal.defn(self, '$to_enum', def.$enum_for);

      return (def.$inspect = function() {
        var self = this;

        return "#<" + (self.$class().$name()) + ": " + (self.enumerator.$inspect()) + ">";
      }, nil) && 'inspect';
    })(self, self);
  })(self, null);
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/enumerator.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass, $gvars = $opal.gvars, $range = $opal.range;

  $opal.add_stubs(['$include', '$new', '$class', '$raise', '$===', '$to_a', '$respond_to?', '$to_ary', '$coerce_to', '$coerce_to?', '$==', '$to_str', '$clone', '$hash', '$<=>', '$inspect', '$empty?', '$enum_for', '$nil?', '$coerce_to!', '$initialize_clone', '$initialize_dup', '$replace', '$eql?', '$length', '$begin', '$end', '$exclude_end?', '$flatten', '$object_id', '$[]', '$to_s', '$join', '$delete_if', '$to_proc', '$each', '$reverse', '$!', '$map', '$rand', '$keep_if', '$shuffle!', '$>', '$<', '$sort', '$times', '$[]=', '$<<', '$at']);
  ;
  return (function($base, $super) {
    function $Array(){};
    var self = $Array = $klass($base, $super, 'Array', $Array);

    var def = self._proto, $scope = self._scope, $a, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5, TMP_6, TMP_7, TMP_8, TMP_9, TMP_10, TMP_11, TMP_12, TMP_13, TMP_14, TMP_15, TMP_17, TMP_18, TMP_19, TMP_20, TMP_21, TMP_24;

    def.length = nil;
    self.$include((($a = $scope.Enumerable) == null ? $opal.cm('Enumerable') : $a));

    def._isArray = true;

    $opal.defs(self, '$[]', function(objects) {
      var self = this;

      objects = $slice.call(arguments, 0);
      return objects;
    });

    def.$initialize = function(args) {
      var $a, self = this;

      args = $slice.call(arguments, 0);
      return ($a = self.$class()).$new.apply($a, [].concat(args));
    };

    $opal.defs(self, '$new', TMP_1 = function(size, obj) {
      var $a, $b, self = this, $iter = TMP_1._p, block = $iter || nil;

      if (size == null) {
        size = nil
      }
      if (obj == null) {
        obj = nil
      }
      TMP_1._p = null;
      if ((($a = arguments.length > 2) !== nil && (!$a._isBoolean || $a == true))) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "wrong number of arguments (" + (arguments.length) + " for 0..2)")};
      if ((($a = arguments.length === 0) !== nil && (!$a._isBoolean || $a == true))) {
        return []};
      if ((($a = arguments.length === 1) !== nil && (!$a._isBoolean || $a == true))) {
        if ((($a = (($b = $scope.Array) == null ? $opal.cm('Array') : $b)['$==='](size)) !== nil && (!$a._isBoolean || $a == true))) {
          return size.$to_a()
        } else if ((($a = size['$respond_to?']("to_ary")) !== nil && (!$a._isBoolean || $a == true))) {
          return size.$to_ary()}};
      size = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(size, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
      if ((($a = size < 0) !== nil && (!$a._isBoolean || $a == true))) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "negative array size")};
      
      var result = [];

      if (block === nil) {
        for (var i = 0; i < size; i++) {
          result.push(obj);
        }
      }
      else {
        for (var i = 0, value; i < size; i++) {
          value = block(i);

          if (value === $breaker) {
            return $breaker.$v;
          }

          result[i] = value;
        }
      }

      return result;
    
    });

    $opal.defs(self, '$try_convert', function(obj) {
      var $a, self = this;

      return (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a)['$coerce_to?'](obj, (($a = $scope.Array) == null ? $opal.cm('Array') : $a), "to_ary");
    });

    def['$&'] = function(other) {
      var $a, $b, self = this;

      if ((($a = (($b = $scope.Array) == null ? $opal.cm('Array') : $b)['$==='](other)) !== nil && (!$a._isBoolean || $a == true))) {
        other = other.$to_a()
        } else {
        other = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(other, (($a = $scope.Array) == null ? $opal.cm('Array') : $a), "to_ary").$to_a()
      };
      
      var result = [],
          seen   = {};

      for (var i = 0, length = self.length; i < length; i++) {
        var item = self[i];

        if (!seen[item]) {
          for (var j = 0, length2 = other.length; j < length2; j++) {
            var item2 = other[j];

            if (!seen[item2] && (item)['$=='](item2)) {
              seen[item] = true;
              result.push(item);
            }
          }
        }
      }

      return result;
    
    };

    def['$*'] = function(other) {
      var $a, self = this;

      if ((($a = other['$respond_to?']("to_str")) !== nil && (!$a._isBoolean || $a == true))) {
        return self.join(other.$to_str())};
      if ((($a = other['$respond_to?']("to_int")) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "no implicit conversion of " + (other.$class()) + " into Integer")
      };
      other = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(other, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
      if ((($a = other < 0) !== nil && (!$a._isBoolean || $a == true))) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "negative argument")};
      
      var result = [];

      for (var i = 0; i < other; i++) {
        result = result.concat(self);
      }

      return result;
    
    };

    def['$+'] = function(other) {
      var $a, $b, self = this;

      if ((($a = (($b = $scope.Array) == null ? $opal.cm('Array') : $b)['$==='](other)) !== nil && (!$a._isBoolean || $a == true))) {
        other = other.$to_a()
        } else {
        other = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(other, (($a = $scope.Array) == null ? $opal.cm('Array') : $a), "to_ary").$to_a()
      };
      return self.concat(other);
    };

    def['$-'] = function(other) {
      var $a, $b, self = this;

      if ((($a = (($b = $scope.Array) == null ? $opal.cm('Array') : $b)['$==='](other)) !== nil && (!$a._isBoolean || $a == true))) {
        other = other.$to_a()
        } else {
        other = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(other, (($a = $scope.Array) == null ? $opal.cm('Array') : $a), "to_ary").$to_a()
      };
      if ((($a = self.length === 0) !== nil && (!$a._isBoolean || $a == true))) {
        return []};
      if ((($a = other.length === 0) !== nil && (!$a._isBoolean || $a == true))) {
        return self.$clone()};
      
      var seen   = {},
          result = [];

      for (var i = 0, length = other.length; i < length; i++) {
        seen[other[i]] = true;
      }

      for (var i = 0, length = self.length; i < length; i++) {
        var item = self[i];

        if (!seen[item]) {
          result.push(item);
        }
      }

      return result;
    
    };

    def['$<<'] = function(object) {
      var self = this;

      self.push(object);
      return self;
    };

    def['$<=>'] = function(other) {
      var $a, $b, self = this;

      if ((($a = (($b = $scope.Array) == null ? $opal.cm('Array') : $b)['$==='](other)) !== nil && (!$a._isBoolean || $a == true))) {
        other = other.$to_a()
      } else if ((($a = other['$respond_to?']("to_ary")) !== nil && (!$a._isBoolean || $a == true))) {
        other = other.$to_ary().$to_a()
        } else {
        return nil
      };
      
      if (self.$hash() === other.$hash()) {
        return 0;
      }

      if (self.length != other.length) {
        return (self.length > other.length) ? 1 : -1;
      }

      for (var i = 0, length = self.length; i < length; i++) {
        var tmp = (self[i])['$<=>'](other[i]);

        if (tmp !== 0) {
          return tmp;
        }
      }

      return 0;
    ;
    };

    def['$=='] = function(other) {
      var $a, $b, self = this;

      if ((($a = self === other) !== nil && (!$a._isBoolean || $a == true))) {
        return true};
      if ((($a = (($b = $scope.Array) == null ? $opal.cm('Array') : $b)['$==='](other)) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        if ((($a = other['$respond_to?']("to_ary")) !== nil && (!$a._isBoolean || $a == true))) {
          } else {
          return false
        };
        return other['$=='](self);
      };
      other = other.$to_a();
      if ((($a = self.length === other.length) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        return false
      };
      
      for (var i = 0, length = self.length; i < length; i++) {
        var a = self[i],
            b = other[i];

        if (a._isArray && b._isArray && (a === self)) {
          continue;
        }

        if (!(a)['$=='](b)) {
          return false;
        }
      }
    
      return true;
    };

    def['$[]'] = function(index, length) {
      var $a, $b, self = this;

      if ((($a = (($b = $scope.Range) == null ? $opal.cm('Range') : $b)['$==='](index)) !== nil && (!$a._isBoolean || $a == true))) {
        
        var size    = self.length,
            exclude = index.exclude,
            from    = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(index.begin, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int"),
            to      = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(index.end, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");

        if (from < 0) {
          from += size;

          if (from < 0) {
            return nil;
          }
        }

        if (from > size) {
          return nil;
        }

        if (to < 0) {
          to += size;

          if (to < 0) {
            return [];
          }
        }

        if (!exclude) {
          to += 1;
        }

        return self.slice(from, to);
      ;
        } else {
        index = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(index, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
        
        var size = self.length;

        if (index < 0) {
          index += size;

          if (index < 0) {
            return nil;
          }
        }

        if (length === undefined) {
          if (index >= size || index < 0) {
            return nil;
          }

          return self[index];
        }
        else {
          length = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(length, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");

          if (length < 0 || index > size || index < 0) {
            return nil;
          }

          return self.slice(index, index + length);
        }
      
      };
    };

    def['$[]='] = function(index, value, extra) {
      var $a, $b, self = this, data = nil, length = nil;

      if ((($a = (($b = $scope.Range) == null ? $opal.cm('Range') : $b)['$==='](index)) !== nil && (!$a._isBoolean || $a == true))) {
        if ((($a = (($b = $scope.Array) == null ? $opal.cm('Array') : $b)['$==='](value)) !== nil && (!$a._isBoolean || $a == true))) {
          data = value.$to_a()
        } else if ((($a = value['$respond_to?']("to_ary")) !== nil && (!$a._isBoolean || $a == true))) {
          data = value.$to_ary().$to_a()
          } else {
          data = [value]
        };
        
        var size    = self.length,
            exclude = index.exclude,
            from    = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(index.begin, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int"),
            to      = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(index.end, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");

        if (from < 0) {
          from += size;

          if (from < 0) {
            self.$raise((($a = $scope.RangeError) == null ? $opal.cm('RangeError') : $a), "" + (index.$inspect()) + " out of range");
          }
        }

        if (to < 0) {
          to += size;
        }

        if (!exclude) {
          to += 1;
        }

        if (from > size) {
          for (var i = size; i < from; i++) {
            self[i] = nil;
          }
        }

        if (to < 0) {
          self.splice.apply(self, [from, 0].concat(data));
        }
        else {
          self.splice.apply(self, [from, to - from].concat(data));
        }

        return value;
      ;
        } else {
        if ((($a = extra === undefined) !== nil && (!$a._isBoolean || $a == true))) {
          length = 1
          } else {
          length = value;
          value = extra;
          if ((($a = (($b = $scope.Array) == null ? $opal.cm('Array') : $b)['$==='](value)) !== nil && (!$a._isBoolean || $a == true))) {
            data = value.$to_a()
          } else if ((($a = value['$respond_to?']("to_ary")) !== nil && (!$a._isBoolean || $a == true))) {
            data = value.$to_ary().$to_a()
            } else {
            data = [value]
          };
        };
        
        var size   = self.length,
            index  = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(index, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int"),
            length = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(length, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int"),
            old;

        if (index < 0) {
          old    = index;
          index += size;

          if (index < 0) {
            self.$raise((($a = $scope.IndexError) == null ? $opal.cm('IndexError') : $a), "index " + (old) + " too small for array; minimum " + (-self.length));
          }
        }

        if (length < 0) {
          self.$raise((($a = $scope.IndexError) == null ? $opal.cm('IndexError') : $a), "negative length (" + (length) + ")")
        }

        if (index > size) {
          for (var i = size; i < index; i++) {
            self[i] = nil;
          }
        }

        if (extra === undefined) {
          self[index] = value;
        }
        else {
          self.splice.apply(self, [index, length].concat(data));
        }

        return value;
      ;
      };
    };

    def.$assoc = function(object) {
      var self = this;

      
      for (var i = 0, length = self.length, item; i < length; i++) {
        if (item = self[i], item.length && (item[0])['$=='](object)) {
          return item;
        }
      }

      return nil;
    
    };

    def.$at = function(index) {
      var $a, self = this;

      index = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(index, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
      
      if (index < 0) {
        index += self.length;
      }

      if (index < 0 || index >= self.length) {
        return nil;
      }

      return self[index];
    
    };

    def.$cycle = TMP_2 = function(n) {
      var $a, $b, self = this, $iter = TMP_2._p, block = $iter || nil;

      if (n == null) {
        n = nil
      }
      TMP_2._p = null;
      if ((($a = ((($b = self['$empty?']()) !== false && $b !== nil) ? $b : n['$=='](0))) !== nil && (!$a._isBoolean || $a == true))) {
        return nil};
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("cycle", n)
      };
      if ((($a = n['$nil?']()) !== nil && (!$a._isBoolean || $a == true))) {
        
        while (true) {
          for (var i = 0, length = self.length; i < length; i++) {
            var value = $opal.$yield1(block, self[i]);

            if (value === $breaker) {
              return $breaker.$v;
            }
          }
        }
      
        } else {
        n = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a)['$coerce_to!'](n, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
        
        if (n <= 0) {
          return self;
        }

        while (n > 0) {
          for (var i = 0, length = self.length; i < length; i++) {
            var value = $opal.$yield1(block, self[i]);

            if (value === $breaker) {
              return $breaker.$v;
            }
          }

          n--;
        }
      
      };
      return self;
    };

    def.$clear = function() {
      var self = this;

      self.splice(0, self.length);
      return self;
    };

    def.$clone = function() {
      var self = this, copy = nil;

      copy = [];
      copy.$initialize_clone(self);
      return copy;
    };

    def.$dup = function() {
      var self = this, copy = nil;

      copy = [];
      copy.$initialize_dup(self);
      return copy;
    };

    def.$initialize_copy = function(other) {
      var self = this;

      return self.$replace(other);
    };

    def.$collect = TMP_3 = function() {
      var self = this, $iter = TMP_3._p, block = $iter || nil;

      TMP_3._p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("collect")
      };
      
      var result = [];

      for (var i = 0, length = self.length; i < length; i++) {
        var value = Opal.$yield1(block, self[i]);

        if (value === $breaker) {
          return $breaker.$v;
        }

        result.push(value);
      }

      return result;
    
    };

    def['$collect!'] = TMP_4 = function() {
      var self = this, $iter = TMP_4._p, block = $iter || nil;

      TMP_4._p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("collect!")
      };
      
      for (var i = 0, length = self.length; i < length; i++) {
        var value = Opal.$yield1(block, self[i]);

        if (value === $breaker) {
          return $breaker.$v;
        }

        self[i] = value;
      }
    
      return self;
    };

    def.$compact = function() {
      var self = this;

      
      var result = [];

      for (var i = 0, length = self.length, item; i < length; i++) {
        if ((item = self[i]) !== nil) {
          result.push(item);
        }
      }

      return result;
    
    };

    def['$compact!'] = function() {
      var self = this;

      
      var original = self.length;

      for (var i = 0, length = self.length; i < length; i++) {
        if (self[i] === nil) {
          self.splice(i, 1);

          length--;
          i--;
        }
      }

      return self.length === original ? nil : self;
    
    };

    def.$concat = function(other) {
      var $a, $b, self = this;

      if ((($a = (($b = $scope.Array) == null ? $opal.cm('Array') : $b)['$==='](other)) !== nil && (!$a._isBoolean || $a == true))) {
        other = other.$to_a()
        } else {
        other = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(other, (($a = $scope.Array) == null ? $opal.cm('Array') : $a), "to_ary").$to_a()
      };
      
      for (var i = 0, length = other.length; i < length; i++) {
        self.push(other[i]);
      }
    
      return self;
    };

    def.$delete = function(object) {
      var self = this;

      
      var original = self.length;

      for (var i = 0, length = original; i < length; i++) {
        if ((self[i])['$=='](object)) {
          self.splice(i, 1);

          length--;
          i--;
        }
      }

      return self.length === original ? nil : object;
    
    };

    def.$delete_at = function(index) {
      var $a, self = this;

      
      index = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(index, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");

      if (index < 0) {
        index += self.length;
      }

      if (index < 0 || index >= self.length) {
        return nil;
      }

      var result = self[index];

      self.splice(index, 1);

      return result;
    ;
    };

    def.$delete_if = TMP_5 = function() {
      var self = this, $iter = TMP_5._p, block = $iter || nil;

      TMP_5._p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("delete_if")
      };
      
      for (var i = 0, length = self.length, value; i < length; i++) {
        if ((value = block(self[i])) === $breaker) {
          return $breaker.$v;
        }

        if (value !== false && value !== nil) {
          self.splice(i, 1);

          length--;
          i--;
        }
      }
    
      return self;
    };

    def.$drop = function(number) {
      var $a, self = this;

      
      if (number < 0) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a))
      }

      return self.slice(number);
    ;
    };

    $opal.defn(self, '$dup', def.$clone);

    def.$each = TMP_6 = function() {
      var self = this, $iter = TMP_6._p, block = $iter || nil;

      TMP_6._p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("each")
      };
      
      for (var i = 0, length = self.length; i < length; i++) {
        var value = $opal.$yield1(block, self[i]);

        if (value == $breaker) {
          return $breaker.$v;
        }
      }
    
      return self;
    };

    def.$each_index = TMP_7 = function() {
      var self = this, $iter = TMP_7._p, block = $iter || nil;

      TMP_7._p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("each_index")
      };
      
      for (var i = 0, length = self.length; i < length; i++) {
        var value = $opal.$yield1(block, i);

        if (value === $breaker) {
          return $breaker.$v;
        }
      }
    
      return self;
    };

    def['$empty?'] = function() {
      var self = this;

      return self.length === 0;
    };

    def['$eql?'] = function(other) {
      var $a, $b, self = this;

      if ((($a = self === other) !== nil && (!$a._isBoolean || $a == true))) {
        return true};
      if ((($a = (($b = $scope.Array) == null ? $opal.cm('Array') : $b)['$==='](other)) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        return false
      };
      other = other.$to_a();
      if ((($a = self.length === other.length) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        return false
      };
      
      for (var i = 0, length = self.length; i < length; i++) {
        var a = self[i],
            b = other[i];

        if (a._isArray && b._isArray && (a === self)) {
          continue;
        }

        if (!(a)['$eql?'](b)) {
          return false;
        }
      }
    
      return true;
    };

    def.$fetch = TMP_8 = function(index, defaults) {
      var $a, self = this, $iter = TMP_8._p, block = $iter || nil;

      TMP_8._p = null;
      
      var original = index;

      index = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(index, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");

      if (index < 0) {
        index += self.length;
      }

      if (index >= 0 && index < self.length) {
        return self[index];
      }

      if (block !== nil) {
        return block(original);
      }

      if (defaults != null) {
        return defaults;
      }

      if (self.length === 0) {
        self.$raise((($a = $scope.IndexError) == null ? $opal.cm('IndexError') : $a), "index " + (original) + " outside of array bounds: 0...0")
      }
      else {
        self.$raise((($a = $scope.IndexError) == null ? $opal.cm('IndexError') : $a), "index " + (original) + " outside of array bounds: -" + (self.length) + "..." + (self.length));
      }
    ;
    };

    def.$fill = TMP_9 = function(args) {
      var $a, $b, self = this, $iter = TMP_9._p, block = $iter || nil, one = nil, two = nil, obj = nil, left = nil, right = nil;

      args = $slice.call(arguments, 0);
      TMP_9._p = null;
      if (block !== false && block !== nil) {
        if ((($a = args.length > 2) !== nil && (!$a._isBoolean || $a == true))) {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "wrong number of arguments (" + (args.$length()) + " for 0..2)")};
        $a = $opal.to_ary(args), one = ($a[0] == null ? nil : $a[0]), two = ($a[1] == null ? nil : $a[1]);
        } else {
        if ((($a = args.length == 0) !== nil && (!$a._isBoolean || $a == true))) {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "wrong number of arguments (0 for 1..3)")
        } else if ((($a = args.length > 3) !== nil && (!$a._isBoolean || $a == true))) {
          self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "wrong number of arguments (" + (args.$length()) + " for 1..3)")};
        $a = $opal.to_ary(args), obj = ($a[0] == null ? nil : $a[0]), one = ($a[1] == null ? nil : $a[1]), two = ($a[2] == null ? nil : $a[2]);
      };
      if ((($a = (($b = $scope.Range) == null ? $opal.cm('Range') : $b)['$==='](one)) !== nil && (!$a._isBoolean || $a == true))) {
        if (two !== false && two !== nil) {
          self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "length invalid with range")};
        left = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(one.$begin(), (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
        if ((($a = left < 0) !== nil && (!$a._isBoolean || $a == true))) {
          left += self.length;};
        if ((($a = left < 0) !== nil && (!$a._isBoolean || $a == true))) {
          self.$raise((($a = $scope.RangeError) == null ? $opal.cm('RangeError') : $a), "" + (one.$inspect()) + " out of range")};
        right = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(one.$end(), (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
        if ((($a = right < 0) !== nil && (!$a._isBoolean || $a == true))) {
          right += self.length;};
        if ((($a = one['$exclude_end?']()) !== nil && (!$a._isBoolean || $a == true))) {
          } else {
          right += 1;
        };
        if ((($a = right <= left) !== nil && (!$a._isBoolean || $a == true))) {
          return self};
      } else if (one !== false && one !== nil) {
        left = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(one, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
        if ((($a = left < 0) !== nil && (!$a._isBoolean || $a == true))) {
          left += self.length;};
        if ((($a = left < 0) !== nil && (!$a._isBoolean || $a == true))) {
          left = 0};
        if (two !== false && two !== nil) {
          right = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(two, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
          if ((($a = right == 0) !== nil && (!$a._isBoolean || $a == true))) {
            return self};
          right += left;
          } else {
          right = self.length
        };
        } else {
        left = 0;
        right = self.length;
      };
      if ((($a = left > self.length) !== nil && (!$a._isBoolean || $a == true))) {
        
        for (var i = self.length; i < right; i++) {
          self[i] = nil;
        }
      ;};
      if ((($a = right > self.length) !== nil && (!$a._isBoolean || $a == true))) {
        self.length = right};
      if (block !== false && block !== nil) {
        
        for (var length = self.length; left < right; left++) {
          var value = block(left);

          if (value === $breaker) {
            return $breaker.$v;
          }

          self[left] = value;
        }
      ;
        } else {
        
        for (var length = self.length; left < right; left++) {
          self[left] = obj;
        }
      ;
      };
      return self;
    };

    def.$first = function(count) {
      var $a, self = this;

      
      if (count == null) {
        return self.length === 0 ? nil : self[0];
      }

      count = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(count, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");

      if (count < 0) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "negative array size");
      }

      return self.slice(0, count);
    
    };

    def.$flatten = function(level) {
      var $a, self = this;

      
      var result = [];

      for (var i = 0, length = self.length; i < length; i++) {
        var item = self[i];

        if ((($a = $scope.Opal) == null ? $opal.cm('Opal') : $a)['$respond_to?'](item, "to_ary")) {
          item = (item).$to_ary();

          if (level == null) {
            result.push.apply(result, (item).$flatten().$to_a());
          }
          else if (level == 0) {
            result.push(item);
          }
          else {
            result.push.apply(result, (item).$flatten(level - 1).$to_a());
          }
        }
        else {
          result.push(item);
        }
      }

      return result;
    ;
    };

    def['$flatten!'] = function(level) {
      var self = this;

      
      var flattened = self.$flatten(level);

      if (self.length == flattened.length) {
        for (var i = 0, length = self.length; i < length; i++) {
          if (self[i] !== flattened[i]) {
            break;
          }
        }

        if (i == length) {
          return nil;
        }
      }

      self.$replace(flattened);
    ;
      return self;
    };

    def.$hash = function() {
      var self = this;

      return self._id || (self._id = Opal.uid());
    };

    def['$include?'] = function(member) {
      var self = this;

      
      for (var i = 0, length = self.length; i < length; i++) {
        if ((self[i])['$=='](member)) {
          return true;
        }
      }

      return false;
    
    };

    def.$index = TMP_10 = function(object) {
      var self = this, $iter = TMP_10._p, block = $iter || nil;

      TMP_10._p = null;
      
      if (object != null) {
        for (var i = 0, length = self.length; i < length; i++) {
          if ((self[i])['$=='](object)) {
            return i;
          }
        }
      }
      else if (block !== nil) {
        for (var i = 0, length = self.length, value; i < length; i++) {
          if ((value = block(self[i])) === $breaker) {
            return $breaker.$v;
          }

          if (value !== false && value !== nil) {
            return i;
          }
        }
      }
      else {
        return self.$enum_for("index");
      }

      return nil;
    
    };

    def.$insert = function(index, objects) {
      var $a, self = this;

      objects = $slice.call(arguments, 1);
      
      index = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(index, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");

      if (objects.length > 0) {
        if (index < 0) {
          index += self.length + 1;

          if (index < 0) {
            self.$raise((($a = $scope.IndexError) == null ? $opal.cm('IndexError') : $a), "" + (index) + " is out of bounds");
          }
        }
        if (index > self.length) {
          for (var i = self.length; i < index; i++) {
            self.push(nil);
          }
        }

        self.splice.apply(self, [index, 0].concat(objects));
      }
    ;
      return self;
    };

    def.$inspect = function() {
      var self = this;

      
      var i, inspect, el, el_insp, length, object_id;

      inspect = [];
      object_id = self.$object_id();
      length = self.length;

      for (i = 0; i < length; i++) {
        el = self['$[]'](i);

        // Check object_id to ensure it's not the same array get into an infinite loop
        el_insp = (el).$object_id() === object_id ? '[...]' : (el).$inspect();

        inspect.push(el_insp);
      }
      return '[' + inspect.join(', ') + ']';
    ;
    };

    def.$join = function(sep) {
      var $a, self = this;
      if ($gvars[","] == null) $gvars[","] = nil;

      if (sep == null) {
        sep = nil
      }
      if ((($a = self.length === 0) !== nil && (!$a._isBoolean || $a == true))) {
        return ""};
      if ((($a = sep === nil) !== nil && (!$a._isBoolean || $a == true))) {
        sep = $gvars[","]};
      
      var result = [];

      for (var i = 0, length = self.length; i < length; i++) {
        var item = self[i];

        if ((($a = $scope.Opal) == null ? $opal.cm('Opal') : $a)['$respond_to?'](item, "to_str")) {
          var tmp = (item).$to_str();

          if (tmp !== nil) {
            result.push((tmp).$to_s());

            continue;
          }
        }

        if ((($a = $scope.Opal) == null ? $opal.cm('Opal') : $a)['$respond_to?'](item, "to_ary")) {
          var tmp = (item).$to_ary();

          if (tmp !== nil) {
            result.push((tmp).$join(sep));

            continue;
          }
        }

        if ((($a = $scope.Opal) == null ? $opal.cm('Opal') : $a)['$respond_to?'](item, "to_s")) {
          var tmp = (item).$to_s();

          if (tmp !== nil) {
            result.push(tmp);

            continue;
          }
        }

        self.$raise((($a = $scope.NoMethodError) == null ? $opal.cm('NoMethodError') : $a), "" + ((($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$inspect(item)) + " doesn't respond to #to_str, #to_ary or #to_s");
      }

      if (sep === nil) {
        return result.join('');
      }
      else {
        return result.join((($a = $scope.Opal) == null ? $opal.cm('Opal') : $a)['$coerce_to!'](sep, (($a = $scope.String) == null ? $opal.cm('String') : $a), "to_str").$to_s());
      }
    ;
    };

    def.$keep_if = TMP_11 = function() {
      var self = this, $iter = TMP_11._p, block = $iter || nil;

      TMP_11._p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("keep_if")
      };
      
      for (var i = 0, length = self.length, value; i < length; i++) {
        if ((value = block(self[i])) === $breaker) {
          return $breaker.$v;
        }

        if (value === false || value === nil) {
          self.splice(i, 1);

          length--;
          i--;
        }
      }
    
      return self;
    };

    def.$last = function(count) {
      var $a, self = this;

      
      if (count == null) {
        return self.length === 0 ? nil : self[self.length - 1];
      }

      count = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(count, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");

      if (count < 0) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "negative array size");
      }

      if (count > self.length) {
        count = self.length;
      }

      return self.slice(self.length - count, self.length);
    
    };

    def.$length = function() {
      var self = this;

      return self.length;
    };

    $opal.defn(self, '$map', def.$collect);

    $opal.defn(self, '$map!', def['$collect!']);

    def.$pop = function(count) {
      var $a, self = this;

      if ((($a = count === undefined) !== nil && (!$a._isBoolean || $a == true))) {
        if ((($a = self.length === 0) !== nil && (!$a._isBoolean || $a == true))) {
          return nil};
        return self.pop();};
      count = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(count, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
      if ((($a = count < 0) !== nil && (!$a._isBoolean || $a == true))) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "negative array size")};
      if ((($a = self.length === 0) !== nil && (!$a._isBoolean || $a == true))) {
        return []};
      if ((($a = count > self.length) !== nil && (!$a._isBoolean || $a == true))) {
        return self.splice(0, self.length);
        } else {
        return self.splice(self.length - count, self.length);
      };
    };

    def.$push = function(objects) {
      var self = this;

      objects = $slice.call(arguments, 0);
      
      for (var i = 0, length = objects.length; i < length; i++) {
        self.push(objects[i]);
      }
    
      return self;
    };

    def.$rassoc = function(object) {
      var self = this;

      
      for (var i = 0, length = self.length, item; i < length; i++) {
        item = self[i];

        if (item.length && item[1] !== undefined) {
          if ((item[1])['$=='](object)) {
            return item;
          }
        }
      }

      return nil;
    
    };

    def.$reject = TMP_12 = function() {
      var self = this, $iter = TMP_12._p, block = $iter || nil;

      TMP_12._p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("reject")
      };
      
      var result = [];

      for (var i = 0, length = self.length, value; i < length; i++) {
        if ((value = block(self[i])) === $breaker) {
          return $breaker.$v;
        }

        if (value === false || value === nil) {
          result.push(self[i]);
        }
      }
      return result;
    
    };

    def['$reject!'] = TMP_13 = function() {
      var $a, $b, self = this, $iter = TMP_13._p, block = $iter || nil, original = nil;

      TMP_13._p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("reject!")
      };
      original = self.$length();
      ($a = ($b = self).$delete_if, $a._p = block.$to_proc(), $a).call($b);
      if (self.$length()['$=='](original)) {
        return nil
        } else {
        return self
      };
    };

    def.$replace = function(other) {
      var $a, $b, self = this;

      if ((($a = (($b = $scope.Array) == null ? $opal.cm('Array') : $b)['$==='](other)) !== nil && (!$a._isBoolean || $a == true))) {
        other = other.$to_a()
        } else {
        other = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(other, (($a = $scope.Array) == null ? $opal.cm('Array') : $a), "to_ary").$to_a()
      };
      
      self.splice(0, self.length);
      self.push.apply(self, other);
    
      return self;
    };

    def.$reverse = function() {
      var self = this;

      return self.slice(0).reverse();
    };

    def['$reverse!'] = function() {
      var self = this;

      return self.reverse();
    };

    def.$reverse_each = TMP_14 = function() {
      var $a, $b, self = this, $iter = TMP_14._p, block = $iter || nil;

      TMP_14._p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("reverse_each")
      };
      ($a = ($b = self.$reverse()).$each, $a._p = block.$to_proc(), $a).call($b);
      return self;
    };

    def.$rindex = TMP_15 = function(object) {
      var self = this, $iter = TMP_15._p, block = $iter || nil;

      TMP_15._p = null;
      
      if (object != null) {
        for (var i = self.length - 1; i >= 0; i--) {
          if ((self[i])['$=='](object)) {
            return i;
          }
        }
      }
      else if (block !== nil) {
        for (var i = self.length - 1, value; i >= 0; i--) {
          if ((value = block(self[i])) === $breaker) {
            return $breaker.$v;
          }

          if (value !== false && value !== nil) {
            return i;
          }
        }
      }
      else if (object == null) {
        return self.$enum_for("rindex");
      }

      return nil;
    
    };

    def.$sample = function(n) {
      var $a, $b, TMP_16, self = this;

      if (n == null) {
        n = nil
      }
      if ((($a = ($b = n['$!'](), $b !== false && $b !== nil ?self['$empty?']() : $b)) !== nil && (!$a._isBoolean || $a == true))) {
        return nil};
      if ((($a = (($b = n !== false && n !== nil) ? self['$empty?']() : $b)) !== nil && (!$a._isBoolean || $a == true))) {
        return []};
      if (n !== false && n !== nil) {
        return ($a = ($b = ($range(1, n, false))).$map, $a._p = (TMP_16 = function(){var self = TMP_16._s || this;

        return self['$[]'](self.$rand(self.$length()))}, TMP_16._s = self, TMP_16), $a).call($b)
        } else {
        return self['$[]'](self.$rand(self.$length()))
      };
    };

    def.$select = TMP_17 = function() {
      var self = this, $iter = TMP_17._p, block = $iter || nil;

      TMP_17._p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("select")
      };
      
      var result = [];

      for (var i = 0, length = self.length, item, value; i < length; i++) {
        item = self[i];

        if ((value = $opal.$yield1(block, item)) === $breaker) {
          return $breaker.$v;
        }

        if (value !== false && value !== nil) {
          result.push(item);
        }
      }

      return result;
    
    };

    def['$select!'] = TMP_18 = function() {
      var $a, $b, self = this, $iter = TMP_18._p, block = $iter || nil;

      TMP_18._p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("select!")
      };
      
      var original = self.length;
      ($a = ($b = self).$keep_if, $a._p = block.$to_proc(), $a).call($b);
      return self.length === original ? nil : self;
    
    };

    def.$shift = function(count) {
      var $a, self = this;

      if ((($a = count === undefined) !== nil && (!$a._isBoolean || $a == true))) {
        if ((($a = self.length === 0) !== nil && (!$a._isBoolean || $a == true))) {
          return nil};
        return self.shift();};
      count = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(count, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
      if ((($a = count < 0) !== nil && (!$a._isBoolean || $a == true))) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "negative array size")};
      if ((($a = self.length === 0) !== nil && (!$a._isBoolean || $a == true))) {
        return []};
      return self.splice(0, count);
    };

    $opal.defn(self, '$size', def.$length);

    def.$shuffle = function() {
      var self = this;

      return self.$clone()['$shuffle!']();
    };

    def['$shuffle!'] = function() {
      var self = this;

      
      for (var i = self.length - 1; i > 0; i--) {
        var tmp = self[i],
            j   = Math.floor(Math.random() * (i + 1));

        self[i] = self[j];
        self[j] = tmp;
      }
    
      return self;
    };

    $opal.defn(self, '$slice', def['$[]']);

    def['$slice!'] = function(index, length) {
      var self = this;

      
      if (index < 0) {
        index += self.length;
      }

      if (length != null) {
        return self.splice(index, length);
      }

      if (index < 0 || index >= self.length) {
        return nil;
      }

      return self.splice(index, 1)[0];
    
    };

    def.$sort = TMP_19 = function() {
      var $a, self = this, $iter = TMP_19._p, block = $iter || nil;

      TMP_19._p = null;
      if ((($a = self.length > 1) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        return self
      };
      
      if (!(block !== nil)) {
        block = function(a, b) {
          return (a)['$<=>'](b);
        };
      }

      try {
        return self.slice().sort(function(x, y) {
          var ret = block(x, y);

          if (ret === $breaker) {
            throw $breaker;
          }
          else if (ret === nil) {
            self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "comparison of " + ((x).$inspect()) + " with " + ((y).$inspect()) + " failed");
          }

          return (ret)['$>'](0) ? 1 : ((ret)['$<'](0) ? -1 : 0);
        });
      }
      catch (e) {
        if (e === $breaker) {
          return $breaker.$v;
        }
        else {
          throw e;
        }
      }
    ;
    };

    def['$sort!'] = TMP_20 = function() {
      var $a, $b, self = this, $iter = TMP_20._p, block = $iter || nil;

      TMP_20._p = null;
      
      var result;

      if ((block !== nil)) {
        result = ($a = ($b = (self.slice())).$sort, $a._p = block.$to_proc(), $a).call($b);
      }
      else {
        result = (self.slice()).$sort();
      }

      self.length = 0;
      for(var i = 0, length = result.length; i < length; i++) {
        self.push(result[i]);
      }

      return self;
    ;
    };

    def.$take = function(count) {
      var $a, self = this;

      
      if (count < 0) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a));
      }

      return self.slice(0, count);
    ;
    };

    def.$take_while = TMP_21 = function() {
      var self = this, $iter = TMP_21._p, block = $iter || nil;

      TMP_21._p = null;
      
      var result = [];

      for (var i = 0, length = self.length, item, value; i < length; i++) {
        item = self[i];

        if ((value = block(item)) === $breaker) {
          return $breaker.$v;
        }

        if (value === false || value === nil) {
          return result;
        }

        result.push(item);
      }

      return result;
    
    };

    def.$to_a = function() {
      var self = this;

      return self;
    };

    $opal.defn(self, '$to_ary', def.$to_a);

    $opal.defn(self, '$to_s', def.$inspect);

    def.$transpose = function() {
      var $a, $b, TMP_22, self = this, result = nil, max = nil;

      if ((($a = self['$empty?']()) !== nil && (!$a._isBoolean || $a == true))) {
        return []};
      result = [];
      max = nil;
      ($a = ($b = self).$each, $a._p = (TMP_22 = function(row){var self = TMP_22._s || this, $a, $b, TMP_23;
if (row == null) row = nil;
      if ((($a = (($b = $scope.Array) == null ? $opal.cm('Array') : $b)['$==='](row)) !== nil && (!$a._isBoolean || $a == true))) {
          row = row.$to_a()
          } else {
          row = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(row, (($a = $scope.Array) == null ? $opal.cm('Array') : $a), "to_ary").$to_a()
        };
        ((($a = max) !== false && $a !== nil) ? $a : max = row.length);
        if ((($a = (row.length)['$=='](max)['$!']()) !== nil && (!$a._isBoolean || $a == true))) {
          self.$raise((($a = $scope.IndexError) == null ? $opal.cm('IndexError') : $a), "element size differs (" + (row.length) + " should be " + (max))};
        return ($a = ($b = (row.length)).$times, $a._p = (TMP_23 = function(i){var self = TMP_23._s || this, $a, $b, $c, entry = nil;
if (i == null) i = nil;
        entry = (($a = i, $b = result, ((($c = $b['$[]']($a)) !== false && $c !== nil) ? $c : $b['$[]=']($a, []))));
          return entry['$<<'](row.$at(i));}, TMP_23._s = self, TMP_23), $a).call($b);}, TMP_22._s = self, TMP_22), $a).call($b);
      return result;
    };

    def.$uniq = function() {
      var self = this;

      
      var result = [],
          seen   = {};

      for (var i = 0, length = self.length, item, hash; i < length; i++) {
        item = self[i];
        hash = item;

        if (!seen[hash]) {
          seen[hash] = true;

          result.push(item);
        }
      }

      return result;
    
    };

    def['$uniq!'] = function() {
      var self = this;

      
      var original = self.length,
          seen     = {};

      for (var i = 0, length = original, item, hash; i < length; i++) {
        item = self[i];
        hash = item;

        if (!seen[hash]) {
          seen[hash] = true;
        }
        else {
          self.splice(i, 1);

          length--;
          i--;
        }
      }

      return self.length === original ? nil : self;
    
    };

    def.$unshift = function(objects) {
      var self = this;

      objects = $slice.call(arguments, 0);
      
      for (var i = objects.length - 1; i >= 0; i--) {
        self.unshift(objects[i]);
      }
    
      return self;
    };

    return (def.$zip = TMP_24 = function(others) {
      var self = this, $iter = TMP_24._p, block = $iter || nil;

      others = $slice.call(arguments, 0);
      TMP_24._p = null;
      
      var result = [], size = self.length, part, o;

      for (var i = 0; i < size; i++) {
        part = [self[i]];

        for (var j = 0, jj = others.length; j < jj; j++) {
          o = others[j][i];

          if (o == null) {
            o = nil;
          }

          part[j + 1] = o;
        }

        result[i] = part;
      }

      if (block !== nil) {
        for (var i = 0; i < size; i++) {
          block(result[i]);
        }

        return nil;
      }

      return result;
    
    }, nil) && 'zip';
  })(self, null);
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/array.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var $a, self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;

  $opal.add_stubs(['$new', '$allocate', '$initialize', '$to_proc', '$__send__', '$clone', '$respond_to?', '$==', '$eql?', '$inspect', '$*', '$class', '$slice', '$uniq', '$flatten']);
  (function($base, $super) {
    function $Array(){};
    var self = $Array = $klass($base, $super, 'Array', $Array);

    var def = self._proto, $scope = self._scope;

    return ($opal.defs(self, '$inherited', function(klass) {
      var $a, $b, self = this, replace = nil;

      replace = (($a = $scope.Class) == null ? $opal.cm('Class') : $a).$new((($a = ((($b = $scope.Array) == null ? $opal.cm('Array') : $b))._scope).Wrapper == null ? $a.cm('Wrapper') : $a.Wrapper));
      
      klass._proto        = replace._proto;
      klass._proto._klass = klass;
      klass._alloc        = replace._alloc;
      klass.__parent      = (($a = ((($b = $scope.Array) == null ? $opal.cm('Array') : $b))._scope).Wrapper == null ? $a.cm('Wrapper') : $a.Wrapper);

      klass.$allocate = replace.$allocate;
      klass.$new      = replace.$new;
      klass["$[]"]    = replace["$[]"];
    
    }), nil) && 'inherited'
  })(self, null);
  return (function($base, $super) {
    function $Wrapper(){};
    var self = $Wrapper = $klass($base, $super, 'Wrapper', $Wrapper);

    var def = self._proto, $scope = self._scope, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5;

    def.literal = nil;
    $opal.defs(self, '$allocate', TMP_1 = function(array) {
      var self = this, $iter = TMP_1._p, $yield = $iter || nil, obj = nil;

      if (array == null) {
        array = []
      }
      TMP_1._p = null;
      obj = $opal.find_super_dispatcher(self, 'allocate', TMP_1, null, $Wrapper).apply(self, []);
      obj.literal = array;
      return obj;
    });

    $opal.defs(self, '$new', TMP_2 = function(args) {
      var $a, $b, self = this, $iter = TMP_2._p, block = $iter || nil, obj = nil;

      args = $slice.call(arguments, 0);
      TMP_2._p = null;
      obj = self.$allocate();
      ($a = ($b = obj).$initialize, $a._p = block.$to_proc(), $a).apply($b, [].concat(args));
      return obj;
    });

    $opal.defs(self, '$[]', function(objects) {
      var self = this;

      objects = $slice.call(arguments, 0);
      return self.$allocate(objects);
    });

    def.$initialize = TMP_3 = function(args) {
      var $a, $b, $c, self = this, $iter = TMP_3._p, block = $iter || nil;

      args = $slice.call(arguments, 0);
      TMP_3._p = null;
      return self.literal = ($a = ($b = (($c = $scope.Array) == null ? $opal.cm('Array') : $c)).$new, $a._p = block.$to_proc(), $a).apply($b, [].concat(args));
    };

    def.$method_missing = TMP_4 = function(args) {
      var $a, $b, self = this, $iter = TMP_4._p, block = $iter || nil, result = nil;

      args = $slice.call(arguments, 0);
      TMP_4._p = null;
      result = ($a = ($b = self.literal).$__send__, $a._p = block.$to_proc(), $a).apply($b, [].concat(args));
      if ((($a = result === self.literal) !== nil && (!$a._isBoolean || $a == true))) {
        return self
        } else {
        return result
      };
    };

    def.$initialize_copy = function(other) {
      var self = this;

      return self.literal = (other.literal).$clone();
    };

    def['$respond_to?'] = TMP_5 = function(name) {var $zuper = $slice.call(arguments, 0);
      var $a, self = this, $iter = TMP_5._p, $yield = $iter || nil;

      TMP_5._p = null;
      return ((($a = $opal.find_super_dispatcher(self, 'respond_to?', TMP_5, $iter).apply(self, $zuper)) !== false && $a !== nil) ? $a : self.literal['$respond_to?'](name));
    };

    def['$=='] = function(other) {
      var self = this;

      return self.literal['$=='](other);
    };

    def['$eql?'] = function(other) {
      var self = this;

      return self.literal['$eql?'](other);
    };

    def.$to_a = function() {
      var self = this;

      return self.literal;
    };

    def.$to_ary = function() {
      var self = this;

      return self;
    };

    def.$inspect = function() {
      var self = this;

      return self.literal.$inspect();
    };

    def['$*'] = function(other) {
      var self = this;

      
      var result = self.literal['$*'](other);

      if (result._isArray) {
        return self.$class().$allocate(result)
      }
      else {
        return result;
      }
    ;
    };

    def['$[]'] = function(index, length) {
      var self = this;

      
      var result = self.literal.$slice(index, length);

      if (result._isArray && (index._isRange || length !== undefined)) {
        return self.$class().$allocate(result)
      }
      else {
        return result;
      }
    ;
    };

    $opal.defn(self, '$slice', def['$[]']);

    def.$uniq = function() {
      var self = this;

      return self.$class().$allocate(self.literal.$uniq());
    };

    return (def.$flatten = function(level) {
      var self = this;

      return self.$class().$allocate(self.literal.$flatten(level));
    }, nil) && 'flatten';
  })((($a = $scope.Array) == null ? $opal.cm('Array') : $a), null);
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/array/inheritance.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;

  $opal.add_stubs(['$include', '$!', '$==', '$call', '$coerce_to!', '$lambda?', '$abs', '$arity', '$raise', '$enum_for', '$flatten', '$inspect', '$===', '$alias_method', '$clone']);
  ;
  return (function($base, $super) {
    function $Hash(){};
    var self = $Hash = $klass($base, $super, 'Hash', $Hash);

    var def = self._proto, $scope = self._scope, $a, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5, TMP_6, TMP_7, TMP_8, TMP_9, TMP_10, TMP_11, TMP_12, TMP_13;

    def.proc = def.none = nil;
    self.$include((($a = $scope.Enumerable) == null ? $opal.cm('Enumerable') : $a));

    $opal.defs(self, '$[]', function(objs) {
      var self = this;

      objs = $slice.call(arguments, 0);
      return $opal.hash.apply(null, objs);
    });

    $opal.defs(self, '$allocate', function() {
      var self = this;

      
      var hash = new self._alloc;

      hash.map  = {};
      hash.keys = [];
      hash.none = nil;
      hash.proc = nil;

      return hash;
    
    });

    def.$initialize = TMP_1 = function(defaults) {
      var self = this, $iter = TMP_1._p, block = $iter || nil;

      TMP_1._p = null;
      
      self.none = (defaults === undefined ? nil : defaults);
      self.proc = block;
    
      return self;
    };

    def['$=='] = function(other) {
      var self = this;

      
      if (self === other) {
        return true;
      }

      if (!other.map || !other.keys) {
        return false;
      }

      if (self.keys.length !== other.keys.length) {
        return false;
      }

      var map  = self.map,
          map2 = other.map;

      for (var i = 0, length = self.keys.length; i < length; i++) {
        var key = self.keys[i], obj = map[key], obj2 = map2[key];
        if (obj2 === undefined || (obj)['$=='](obj2)['$!']()) {
          return false;
        }
      }

      return true;
    
    };

    def['$[]'] = function(key) {
      var self = this;

      
      var map = self.map;

      if ($opal.hasOwnProperty.call(map, key)) {
        return map[key];
      }

      var proc = self.proc;

      if (proc !== nil) {
        return (proc).$call(self, key);
      }

      return self.none;
    
    };

    def['$[]='] = function(key, value) {
      var self = this;

      
      var map = self.map;

      if (!$opal.hasOwnProperty.call(map, key)) {
        self.keys.push(key);
      }

      map[key] = value;

      return value;
    
    };

    def.$assoc = function(object) {
      var self = this;

      
      var keys = self.keys, key;

      for (var i = 0, length = keys.length; i < length; i++) {
        key = keys[i];

        if ((key)['$=='](object)) {
          return [key, self.map[key]];
        }
      }

      return nil;
    
    };

    def.$clear = function() {
      var self = this;

      
      self.map = {};
      self.keys = [];
      return self;
    
    };

    def.$clone = function() {
      var self = this;

      
      var map  = {},
          keys = [];

      for (var i = 0, length = self.keys.length; i < length; i++) {
        var key   = self.keys[i],
            value = self.map[key];

        keys.push(key);
        map[key] = value;
      }

      var hash = new self._klass._alloc();

      hash.map  = map;
      hash.keys = keys;
      hash.none = self.none;
      hash.proc = self.proc;

      return hash;
    
    };

    def.$default = function(val) {
      var self = this;

      
      if (val !== undefined && self.proc !== nil) {
        return self.proc.$call(self, val);
      }
      return self.none;
    ;
    };

    def['$default='] = function(object) {
      var self = this;

      
      self.proc = nil;
      return (self.none = object);
    
    };

    def.$default_proc = function() {
      var self = this;

      return self.proc;
    };

    def['$default_proc='] = function(proc) {
      var $a, self = this;

      
      if (proc !== nil) {
        proc = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a)['$coerce_to!'](proc, (($a = $scope.Proc) == null ? $opal.cm('Proc') : $a), "to_proc");

        if (proc['$lambda?']() && proc.$arity().$abs() != 2) {
          self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "default_proc takes two arguments");
        }
      }
      self.none = nil;
      return (self.proc = proc);
    ;
    };

    def.$delete = TMP_2 = function(key) {
      var self = this, $iter = TMP_2._p, block = $iter || nil;

      TMP_2._p = null;
      
      var map  = self.map, result = map[key];

      if (result != null) {
        delete map[key];
        self.keys.$delete(key);

        return result;
      }

      if (block !== nil) {
        return block.$call(key);
      }
      return nil;
    
    };

    def.$delete_if = TMP_3 = function() {
      var self = this, $iter = TMP_3._p, block = $iter || nil;

      TMP_3._p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("delete_if")
      };
      
      var map = self.map, keys = self.keys, value;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], obj = map[key];

        if ((value = block(key, obj)) === $breaker) {
          return $breaker.$v;
        }

        if (value !== false && value !== nil) {
          keys.splice(i, 1);
          delete map[key];

          length--;
          i--;
        }
      }

      return self;
    
    };

    $opal.defn(self, '$dup', def.$clone);

    def.$each = TMP_4 = function() {
      var self = this, $iter = TMP_4._p, block = $iter || nil;

      TMP_4._p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("each")
      };
      
      var map  = self.map,
          keys = self.keys;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key   = keys[i],
            value = $opal.$yield1(block, [key, map[key]]);

        if (value === $breaker) {
          return $breaker.$v;
        }
      }

      return self;
    
    };

    def.$each_key = TMP_5 = function() {
      var self = this, $iter = TMP_5._p, block = $iter || nil;

      TMP_5._p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("each_key")
      };
      
      var keys = self.keys;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i];

        if (block(key) === $breaker) {
          return $breaker.$v;
        }
      }

      return self;
    
    };

    $opal.defn(self, '$each_pair', def.$each);

    def.$each_value = TMP_6 = function() {
      var self = this, $iter = TMP_6._p, block = $iter || nil;

      TMP_6._p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("each_value")
      };
      
      var map = self.map, keys = self.keys;

      for (var i = 0, length = keys.length; i < length; i++) {
        if (block(map[keys[i]]) === $breaker) {
          return $breaker.$v;
        }
      }

      return self;
    
    };

    def['$empty?'] = function() {
      var self = this;

      return self.keys.length === 0;
    };

    $opal.defn(self, '$eql?', def['$==']);

    def.$fetch = TMP_7 = function(key, defaults) {
      var $a, self = this, $iter = TMP_7._p, block = $iter || nil;

      TMP_7._p = null;
      
      var value = self.map[key];

      if (value != null) {
        return value;
      }

      if (block !== nil) {
        var value;

        if ((value = block(key)) === $breaker) {
          return $breaker.$v;
        }

        return value;
      }

      if (defaults != null) {
        return defaults;
      }

      self.$raise((($a = $scope.KeyError) == null ? $opal.cm('KeyError') : $a), "key not found");
    
    };

    def.$flatten = function(level) {
      var self = this;

      
      var map = self.map, keys = self.keys, result = [];

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], value = map[key];

        result.push(key);

        if (value._isArray) {
          if (level == null || level === 1) {
            result.push(value);
          }
          else {
            result = result.concat((value).$flatten(level - 1));
          }
        }
        else {
          result.push(value);
        }
      }

      return result;
    
    };

    def['$has_key?'] = function(key) {
      var self = this;

      return $opal.hasOwnProperty.call(self.map, key);
    };

    def['$has_value?'] = function(value) {
      var self = this;

      
      for (var assoc in self.map) {
        if ((self.map[assoc])['$=='](value)) {
          return true;
        }
      }

      return false;
    ;
    };

    def.$hash = function() {
      var self = this;

      return self._id;
    };

    $opal.defn(self, '$include?', def['$has_key?']);

    def.$index = function(object) {
      var self = this;

      
      var map = self.map, keys = self.keys;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i];

        if ((map[key])['$=='](object)) {
          return key;
        }
      }

      return nil;
    
    };

    def.$indexes = function(keys) {
      var self = this;

      keys = $slice.call(arguments, 0);
      
      var result = [], map = self.map, val;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], val = map[key];

        if (val != null) {
          result.push(val);
        }
        else {
          result.push(self.none);
        }
      }

      return result;
    
    };

    $opal.defn(self, '$indices', def.$indexes);

    def.$inspect = function() {
      var self = this;

      
      var inspect = [], keys = self.keys, map = self.map;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], val = map[key];

        if (val === self) {
          inspect.push((key).$inspect() + '=>' + '{...}');
        } else {
          inspect.push((key).$inspect() + '=>' + (map[key]).$inspect());
        }
      }

      return '{' + inspect.join(', ') + '}';
    ;
    };

    def.$invert = function() {
      var self = this;

      
      var result = $opal.hash(), keys = self.keys, map = self.map,
          keys2 = result.keys, map2 = result.map;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], obj = map[key];

        keys2.push(obj);
        map2[obj] = key;
      }

      return result;
    
    };

    def.$keep_if = TMP_8 = function() {
      var self = this, $iter = TMP_8._p, block = $iter || nil;

      TMP_8._p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("keep_if")
      };
      
      var map = self.map, keys = self.keys, value;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], obj = map[key];

        if ((value = block(key, obj)) === $breaker) {
          return $breaker.$v;
        }

        if (value === false || value === nil) {
          keys.splice(i, 1);
          delete map[key];

          length--;
          i--;
        }
      }

      return self;
    
    };

    $opal.defn(self, '$key', def.$index);

    $opal.defn(self, '$key?', def['$has_key?']);

    def.$keys = function() {
      var self = this;

      return self.keys.slice(0);
    };

    def.$length = function() {
      var self = this;

      return self.keys.length;
    };

    $opal.defn(self, '$member?', def['$has_key?']);

    def.$merge = TMP_9 = function(other) {
      var $a, self = this, $iter = TMP_9._p, block = $iter || nil;

      TMP_9._p = null;
      
      if (! (($a = $scope.Hash) == null ? $opal.cm('Hash') : $a)['$==='](other)) {
        other = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a)['$coerce_to!'](other, (($a = $scope.Hash) == null ? $opal.cm('Hash') : $a), "to_hash");
      }

      var keys = self.keys, map = self.map,
          result = $opal.hash(), keys2 = result.keys, map2 = result.map;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i];

        keys2.push(key);
        map2[key] = map[key];
      }

      var keys = other.keys, map = other.map;

      if (block === nil) {
        for (var i = 0, length = keys.length; i < length; i++) {
          var key = keys[i];

          if (map2[key] == null) {
            keys2.push(key);
          }

          map2[key] = map[key];
        }
      }
      else {
        for (var i = 0, length = keys.length; i < length; i++) {
          var key = keys[i];

          if (map2[key] == null) {
            keys2.push(key);
            map2[key] = map[key];
          }
          else {
            map2[key] = block(key, map2[key], map[key]);
          }
        }
      }

      return result;
    ;
    };

    def['$merge!'] = TMP_10 = function(other) {
      var $a, self = this, $iter = TMP_10._p, block = $iter || nil;

      TMP_10._p = null;
      
      if (! (($a = $scope.Hash) == null ? $opal.cm('Hash') : $a)['$==='](other)) {
        other = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a)['$coerce_to!'](other, (($a = $scope.Hash) == null ? $opal.cm('Hash') : $a), "to_hash");
      }

      var keys = self.keys, map = self.map,
          keys2 = other.keys, map2 = other.map;

      if (block === nil) {
        for (var i = 0, length = keys2.length; i < length; i++) {
          var key = keys2[i];

          if (map[key] == null) {
            keys.push(key);
          }

          map[key] = map2[key];
        }
      }
      else {
        for (var i = 0, length = keys2.length; i < length; i++) {
          var key = keys2[i];

          if (map[key] == null) {
            keys.push(key);
            map[key] = map2[key];
          }
          else {
            map[key] = block(key, map[key], map2[key]);
          }
        }
      }

      return self;
    ;
    };

    def.$rassoc = function(object) {
      var self = this;

      
      var keys = self.keys, map = self.map;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], obj = map[key];

        if ((obj)['$=='](object)) {
          return [key, obj];
        }
      }

      return nil;
    
    };

    def.$reject = TMP_11 = function() {
      var self = this, $iter = TMP_11._p, block = $iter || nil;

      TMP_11._p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("reject")
      };
      
      var keys = self.keys, map = self.map,
          result = $opal.hash(), map2 = result.map, keys2 = result.keys;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], obj = map[key], value;

        if ((value = block(key, obj)) === $breaker) {
          return $breaker.$v;
        }

        if (value === false || value === nil) {
          keys2.push(key);
          map2[key] = obj;
        }
      }

      return result;
    
    };

    def.$replace = function(other) {
      var self = this;

      
      var map = self.map = {}, keys = self.keys = [];

      for (var i = 0, length = other.keys.length; i < length; i++) {
        var key = other.keys[i];
        keys.push(key);
        map[key] = other.map[key];
      }

      return self;
    
    };

    def.$select = TMP_12 = function() {
      var self = this, $iter = TMP_12._p, block = $iter || nil;

      TMP_12._p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("select")
      };
      
      var keys = self.keys, map = self.map,
          result = $opal.hash(), map2 = result.map, keys2 = result.keys;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], obj = map[key], value;

        if ((value = block(key, obj)) === $breaker) {
          return $breaker.$v;
        }

        if (value !== false && value !== nil) {
          keys2.push(key);
          map2[key] = obj;
        }
      }

      return result;
    
    };

    def['$select!'] = TMP_13 = function() {
      var self = this, $iter = TMP_13._p, block = $iter || nil;

      TMP_13._p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("select!")
      };
      
      var map = self.map, keys = self.keys, value, result = nil;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i], obj = map[key];

        if ((value = block(key, obj)) === $breaker) {
          return $breaker.$v;
        }

        if (value === false || value === nil) {
          keys.splice(i, 1);
          delete map[key];

          length--;
          i--;
          result = self
        }
      }

      return result;
    
    };

    def.$shift = function() {
      var self = this;

      
      var keys = self.keys, map = self.map;

      if (keys.length) {
        var key = keys[0], obj = map[key];

        delete map[key];
        keys.splice(0, 1);

        return [key, obj];
      }

      return nil;
    
    };

    $opal.defn(self, '$size', def.$length);

    self.$alias_method("store", "[]=");

    def.$to_a = function() {
      var self = this;

      
      var keys = self.keys, map = self.map, result = [];

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i];
        result.push([key, map[key]]);
      }

      return result;
    
    };

    def.$to_h = function() {
      var self = this;

      
      var hash   = new Opal.Hash._alloc,
          cloned = self.$clone();

      hash.map  = cloned.map;
      hash.keys = cloned.keys;
      hash.none = cloned.none;
      hash.proc = cloned.proc;

      return hash;
    ;
    };

    def.$to_hash = function() {
      var self = this;

      return self;
    };

    $opal.defn(self, '$to_s', def.$inspect);

    $opal.defn(self, '$update', def['$merge!']);

    $opal.defn(self, '$value?', def['$has_value?']);

    $opal.defn(self, '$values_at', def.$indexes);

    return (def.$values = function() {
      var self = this;

      
      var map    = self.map,
          result = [];

      for (var key in map) {
        result.push(map[key]);
      }

      return result;
    
    }, nil) && 'values';
  })(self, null);
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/hash.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var $a, self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass, $gvars = $opal.gvars;

  $opal.add_stubs(['$include', '$to_str', '$===', '$format', '$coerce_to', '$to_s', '$respond_to?', '$<=>', '$raise', '$=~', '$empty?', '$ljust', '$ceil', '$/', '$+', '$rjust', '$floor', '$to_a', '$each_char', '$to_proc', '$coerce_to!', '$initialize_clone', '$initialize_dup', '$enum_for', '$split', '$chomp', '$escape', '$class', '$to_i', '$name', '$!', '$each_line', '$match', '$new', '$try_convert', '$chars', '$&', '$join', '$is_a?', '$[]', '$str', '$value', '$proc', '$send']);
  ;
  (function($base, $super) {
    function $String(){};
    var self = $String = $klass($base, $super, 'String', $String);

    var def = self._proto, $scope = self._scope, $a, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5, TMP_6, TMP_7;

    def.length = nil;
    self.$include((($a = $scope.Comparable) == null ? $opal.cm('Comparable') : $a));

    def._isString = true;

    $opal.defs(self, '$try_convert', function(what) {
      var self = this;

      try {
      return what.$to_str()
      } catch ($err) {if (true) {
        return nil
        }else { throw $err; }
      };
    });

    $opal.defs(self, '$new', function(str) {
      var self = this;

      if (str == null) {
        str = ""
      }
      return new String(str);
    });

    def['$%'] = function(data) {
      var $a, $b, self = this;

      if ((($a = (($b = $scope.Array) == null ? $opal.cm('Array') : $b)['$==='](data)) !== nil && (!$a._isBoolean || $a == true))) {
        return ($a = self).$format.apply($a, [self].concat(data))
        } else {
        return self.$format(self, data)
      };
    };

    def['$*'] = function(count) {
      var self = this;

      
      if (count < 1) {
        return '';
      }

      var result  = '',
          pattern = self;

      while (count > 0) {
        if (count & 1) {
          result += pattern;
        }

        count >>= 1;
        pattern += pattern;
      }

      return result;
    
    };

    def['$+'] = function(other) {
      var $a, self = this;

      other = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(other, (($a = $scope.String) == null ? $opal.cm('String') : $a), "to_str");
      return self + other.$to_s();
    };

    def['$<=>'] = function(other) {
      var $a, self = this;

      if ((($a = other['$respond_to?']("to_str")) !== nil && (!$a._isBoolean || $a == true))) {
        other = other.$to_str().$to_s();
        return self > other ? 1 : (self < other ? -1 : 0);
        } else {
        
        var cmp = other['$<=>'](self);

        if (cmp === nil) {
          return nil;
        }
        else {
          return cmp > 0 ? -1 : (cmp < 0 ? 1 : 0);
        }
      ;
      };
    };

    def['$=='] = function(other) {
      var $a, $b, self = this;

      if ((($a = (($b = $scope.String) == null ? $opal.cm('String') : $b)['$==='](other)) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        return false
      };
      return self.$to_s() == other.$to_s();
    };

    $opal.defn(self, '$eql?', def['$==']);

    $opal.defn(self, '$===', def['$==']);

    def['$=~'] = function(other) {
      var $a, self = this;

      
      if (other._isString) {
        self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "type mismatch: String given");
      }

      return other['$=~'](self);
    ;
    };

    def['$[]'] = function(index, length) {
      var self = this;

      
      var size = self.length;

      if (index._isRange) {
        var exclude = index.exclude,
            length  = index.end,
            index   = index.begin;

        if (index < 0) {
          index += size;
        }

        if (length < 0) {
          length += size;
        }

        if (!exclude) {
          length += 1;
        }

        if (index > size) {
          return nil;
        }

        length = length - index;

        if (length < 0) {
          length = 0;
        }

        return self.substr(index, length);
      }

      if (index < 0) {
        index += self.length;
      }

      if (length == null) {
        if (index >= self.length || index < 0) {
          return nil;
        }

        return self.substr(index, 1);
      }

      if (index > self.length || index < 0) {
        return nil;
      }

      return self.substr(index, length);
    
    };

    def.$capitalize = function() {
      var self = this;

      return self.charAt(0).toUpperCase() + self.substr(1).toLowerCase();
    };

    def.$casecmp = function(other) {
      var $a, self = this;

      other = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(other, (($a = $scope.String) == null ? $opal.cm('String') : $a), "to_str").$to_s();
      return (self.toLowerCase())['$<=>'](other.toLowerCase());
    };

    def.$center = function(width, padstr) {
      var $a, self = this;

      if (padstr == null) {
        padstr = " "
      }
      width = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(width, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
      padstr = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(padstr, (($a = $scope.String) == null ? $opal.cm('String') : $a), "to_str").$to_s();
      if ((($a = padstr['$empty?']()) !== nil && (!$a._isBoolean || $a == true))) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "zero width padding")};
      if ((($a = width <= self.length) !== nil && (!$a._isBoolean || $a == true))) {
        return self};
      
      var ljustified = self.$ljust((width['$+'](self.length))['$/'](2).$ceil(), padstr),
          rjustified = self.$rjust((width['$+'](self.length))['$/'](2).$floor(), padstr);

      return rjustified + ljustified.slice(self.length);
    ;
    };

    def.$chars = TMP_1 = function() {
      var $a, $b, self = this, $iter = TMP_1._p, block = $iter || nil;

      TMP_1._p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$each_char().$to_a()
      };
      return ($a = ($b = self).$each_char, $a._p = block.$to_proc(), $a).call($b);
    };

    def.$chomp = function(separator) {
      var $a, self = this;
      if ($gvars["/"] == null) $gvars["/"] = nil;

      if (separator == null) {
        separator = $gvars["/"]
      }
      if ((($a = separator === nil || self.length === 0) !== nil && (!$a._isBoolean || $a == true))) {
        return self};
      separator = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a)['$coerce_to!'](separator, (($a = $scope.String) == null ? $opal.cm('String') : $a), "to_str").$to_s();
      
      if (separator === "\n") {
        return self.replace(/\r?\n?$/, '');
      }
      else if (separator === "") {
        return self.replace(/(\r?\n)+$/, '');
      }
      else if (self.length > separator.length) {
        var tail = self.substr(self.length - separator.length, separator.length);

        if (tail === separator) {
          return self.substr(0, self.length - separator.length);
        }
      }
    
      return self;
    };

    def.$chop = function() {
      var self = this;

      
      var length = self.length;

      if (length <= 1) {
        return "";
      }

      if (self.charAt(length - 1) === "\n" && self.charAt(length - 2) === "\r") {
        return self.substr(0, length - 2);
      }
      else {
        return self.substr(0, length - 1);
      }
    
    };

    def.$chr = function() {
      var self = this;

      return self.charAt(0);
    };

    def.$clone = function() {
      var self = this, copy = nil;

      copy = self.slice();
      copy.$initialize_clone(self);
      return copy;
    };

    def.$dup = function() {
      var self = this, copy = nil;

      copy = self.slice();
      copy.$initialize_dup(self);
      return copy;
    };

    def.$count = function(str) {
      var self = this;

      return (self.length - self.replace(new RegExp(str, 'g'), '').length) / str.length;
    };

    $opal.defn(self, '$dup', def.$clone);

    def.$downcase = function() {
      var self = this;

      return self.toLowerCase();
    };

    def.$each_char = TMP_2 = function() {
      var $a, self = this, $iter = TMP_2._p, block = $iter || nil;

      TMP_2._p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("each_char")
      };
      
      for (var i = 0, length = self.length; i < length; i++) {
        ((($a = $opal.$yield1(block, self.charAt(i))) === $breaker) ? $breaker.$v : $a);
      }
    
      return self;
    };

    def.$each_line = TMP_3 = function(separator) {
      var $a, self = this, $iter = TMP_3._p, $yield = $iter || nil;
      if ($gvars["/"] == null) $gvars["/"] = nil;

      if (separator == null) {
        separator = $gvars["/"]
      }
      TMP_3._p = null;
      if (($yield !== nil)) {
        } else {
        return self.$split(separator)
      };
      
      var chomped  = self.$chomp(),
          trailing = self.length != chomped.length,
          splitted = chomped.split(separator);

      for (var i = 0, length = splitted.length; i < length; i++) {
        if (i < length - 1 || trailing) {
          ((($a = $opal.$yield1($yield, splitted[i] + separator)) === $breaker) ? $breaker.$v : $a);
        }
        else {
          ((($a = $opal.$yield1($yield, splitted[i])) === $breaker) ? $breaker.$v : $a);
        }
      }
    ;
      return self;
    };

    def['$empty?'] = function() {
      var self = this;

      return self.length === 0;
    };

    def['$end_with?'] = function(suffixes) {
      var $a, self = this;

      suffixes = $slice.call(arguments, 0);
      
      for (var i = 0, length = suffixes.length; i < length; i++) {
        var suffix = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(suffixes[i], (($a = $scope.String) == null ? $opal.cm('String') : $a), "to_str").$to_s();

        if (self.length >= suffix.length &&
            self.substr(self.length - suffix.length, suffix.length) == suffix) {
          return true;
        }
      }
    
      return false;
    };

    $opal.defn(self, '$eql?', def['$==']);

    $opal.defn(self, '$equal?', def['$===']);

    def.$gsub = TMP_4 = function(pattern, replace) {
      var $a, $b, $c, self = this, $iter = TMP_4._p, block = $iter || nil;

      TMP_4._p = null;
      if ((($a = ((($b = (($c = $scope.String) == null ? $opal.cm('String') : $c)['$==='](pattern)) !== false && $b !== nil) ? $b : pattern['$respond_to?']("to_str"))) !== nil && (!$a._isBoolean || $a == true))) {
        pattern = (new RegExp("" + (($a = $scope.Regexp) == null ? $opal.cm('Regexp') : $a).$escape(pattern.$to_str())))};
      if ((($a = (($b = $scope.Regexp) == null ? $opal.cm('Regexp') : $b)['$==='](pattern)) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "wrong argument type " + (pattern.$class()) + " (expected Regexp)")
      };
      
      var pattern = pattern.toString(),
          options = pattern.substr(pattern.lastIndexOf('/') + 1) + 'g',
          regexp  = pattern.substr(1, pattern.lastIndexOf('/') - 1);

      self.$sub._p = block;
      return self.$sub(new RegExp(regexp, options), replace);
    
    };

    def.$hash = function() {
      var self = this;

      return self.toString();
    };

    def.$hex = function() {
      var self = this;

      return self.$to_i(16);
    };

    def['$include?'] = function(other) {
      var $a, self = this;

      
      if (other._isString) {
        return self.indexOf(other) !== -1;
      }
    
      if ((($a = other['$respond_to?']("to_str")) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "no implicit conversion of " + (other.$class().$name()) + " into String")
      };
      return self.indexOf(other.$to_str()) !== -1;
    };

    def.$index = function(what, offset) {
      var $a, $b, self = this, result = nil;

      if (offset == null) {
        offset = nil
      }
      if ((($a = (($b = $scope.String) == null ? $opal.cm('String') : $b)['$==='](what)) !== nil && (!$a._isBoolean || $a == true))) {
        what = what.$to_s()
      } else if ((($a = what['$respond_to?']("to_str")) !== nil && (!$a._isBoolean || $a == true))) {
        what = what.$to_str().$to_s()
      } else if ((($a = (($b = $scope.Regexp) == null ? $opal.cm('Regexp') : $b)['$==='](what)['$!']()) !== nil && (!$a._isBoolean || $a == true))) {
        self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "type mismatch: " + (what.$class()) + " given")};
      result = -1;
      if (offset !== false && offset !== nil) {
        offset = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(offset, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
        
        var size = self.length;

        if (offset < 0) {
          offset = offset + size;
        }

        if (offset > size) {
          return nil;
        }
      
        if ((($a = (($b = $scope.Regexp) == null ? $opal.cm('Regexp') : $b)['$==='](what)) !== nil && (!$a._isBoolean || $a == true))) {
          result = ((($a = (what['$=~'](self.substr(offset)))) !== false && $a !== nil) ? $a : -1)
          } else {
          result = self.substr(offset).indexOf(what)
        };
        
        if (result !== -1) {
          result += offset;
        }
      
      } else if ((($a = (($b = $scope.Regexp) == null ? $opal.cm('Regexp') : $b)['$==='](what)) !== nil && (!$a._isBoolean || $a == true))) {
        result = ((($a = (what['$=~'](self))) !== false && $a !== nil) ? $a : -1)
        } else {
        result = self.indexOf(what)
      };
      if ((($a = result === -1) !== nil && (!$a._isBoolean || $a == true))) {
        return nil
        } else {
        return result
      };
    };

    def.$inspect = function() {
      var self = this;

      
      var escapable = /[\\\"\x00-\x1f\x7f-\x9f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,
          meta      = {
            '\b': '\\b',
            '\t': '\\t',
            '\n': '\\n',
            '\f': '\\f',
            '\r': '\\r',
            '"' : '\\"',
            '\\': '\\\\'
          };

      escapable.lastIndex = 0;

      return escapable.test(self) ? '"' + self.replace(escapable, function(a) {
        var c = meta[a];

        return typeof c === 'string' ? c :
          '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
      }) + '"' : '"' + self + '"';
    
    };

    def.$intern = function() {
      var self = this;

      return self;
    };

    def.$lines = function(separator) {
      var self = this;
      if ($gvars["/"] == null) $gvars["/"] = nil;

      if (separator == null) {
        separator = $gvars["/"]
      }
      return self.$each_line(separator).$to_a();
    };

    def.$length = function() {
      var self = this;

      return self.length;
    };

    def.$ljust = function(width, padstr) {
      var $a, self = this;

      if (padstr == null) {
        padstr = " "
      }
      width = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(width, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
      padstr = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(padstr, (($a = $scope.String) == null ? $opal.cm('String') : $a), "to_str").$to_s();
      if ((($a = padstr['$empty?']()) !== nil && (!$a._isBoolean || $a == true))) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "zero width padding")};
      if ((($a = width <= self.length) !== nil && (!$a._isBoolean || $a == true))) {
        return self};
      
      var index  = -1,
          result = "";

      width -= self.length;

      while (++index < width) {
        result += padstr;
      }

      return self + result.slice(0, width);
    
    };

    def.$lstrip = function() {
      var self = this;

      return self.replace(/^\s*/, '');
    };

    def.$match = TMP_5 = function(pattern, pos) {
      var $a, $b, $c, self = this, $iter = TMP_5._p, block = $iter || nil;

      TMP_5._p = null;
      if ((($a = ((($b = (($c = $scope.String) == null ? $opal.cm('String') : $c)['$==='](pattern)) !== false && $b !== nil) ? $b : pattern['$respond_to?']("to_str"))) !== nil && (!$a._isBoolean || $a == true))) {
        pattern = (new RegExp("" + (($a = $scope.Regexp) == null ? $opal.cm('Regexp') : $a).$escape(pattern.$to_str())))};
      if ((($a = (($b = $scope.Regexp) == null ? $opal.cm('Regexp') : $b)['$==='](pattern)) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "wrong argument type " + (pattern.$class()) + " (expected Regexp)")
      };
      return ($a = ($b = pattern).$match, $a._p = block.$to_proc(), $a).call($b, self, pos);
    };

    def.$next = function() {
      var self = this;

      
      if (self.length === 0) {
        return "";
      }

      var initial = self.substr(0, self.length - 1);
      var last    = String.fromCharCode(self.charCodeAt(self.length - 1) + 1);

      return initial + last;
    
    };

    def.$ord = function() {
      var self = this;

      return self.charCodeAt(0);
    };

    def.$partition = function(str) {
      var self = this;

      
      var result = self.split(str);
      var splitter = (result[0].length === self.length ? "" : str);

      return [result[0], splitter, result.slice(1).join(str.toString())];
    
    };

    def.$reverse = function() {
      var self = this;

      return self.split('').reverse().join('');
    };

    def.$rindex = function(search, offset) {
      var $a, self = this;

      
      var search_type = (search == null ? Opal.NilClass : search.constructor);
      if (search_type != String && search_type != RegExp) {
        var msg = "type mismatch: " + search_type + " given";
        self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a).$new(msg));
      }

      if (self.length == 0) {
        return search.length == 0 ? 0 : nil;
      }

      var result = -1;
      if (offset != null) {
        if (offset < 0) {
          offset = self.length + offset;
        }

        if (search_type == String) {
          result = self.lastIndexOf(search, offset);
        }
        else {
          result = self.substr(0, offset + 1).$reverse().search(search);
          if (result !== -1) {
            result = offset - result;
          }
        }
      }
      else {
        if (search_type == String) {
          result = self.lastIndexOf(search);
        }
        else {
          result = self.$reverse().search(search);
          if (result !== -1) {
            result = self.length - 1 - result;
          }
        }
      }

      return result === -1 ? nil : result;
    
    };

    def.$rjust = function(width, padstr) {
      var $a, self = this;

      if (padstr == null) {
        padstr = " "
      }
      width = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(width, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
      padstr = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(padstr, (($a = $scope.String) == null ? $opal.cm('String') : $a), "to_str").$to_s();
      if ((($a = padstr['$empty?']()) !== nil && (!$a._isBoolean || $a == true))) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "zero width padding")};
      if ((($a = width <= self.length) !== nil && (!$a._isBoolean || $a == true))) {
        return self};
      
      var chars     = Math.floor(width - self.length),
          patterns  = Math.floor(chars / padstr.length),
          result    = Array(patterns + 1).join(padstr),
          remaining = chars - result.length;

      return result + padstr.slice(0, remaining) + self;
    
    };

    def.$rstrip = function() {
      var self = this;

      return self.replace(/\s*$/, '');
    };

    def.$scan = TMP_6 = function(pattern) {
      var $a, self = this, $iter = TMP_6._p, block = $iter || nil;

      TMP_6._p = null;
      
      if (pattern.global) {
        // should we clear it afterwards too?
        pattern.lastIndex = 0;
      }
      else {
        // rewrite regular expression to add the global flag to capture pre/post match
        pattern = new RegExp(pattern.source, 'g' + (pattern.multiline ? 'm' : '') + (pattern.ignoreCase ? 'i' : ''));
      }

      var result = [];
      var match;

      while ((match = pattern.exec(self)) != null) {
        var match_data = (($a = $scope.MatchData) == null ? $opal.cm('MatchData') : $a).$new(pattern, match);
        if (block === nil) {
          match.length == 1 ? result.push(match[0]) : result.push(match.slice(1));
        }
        else {
          match.length == 1 ? block(match[0]) : block.apply(self, match.slice(1));
        }
      }

      return (block !== nil ? self : result);
    
    };

    $opal.defn(self, '$size', def.$length);

    $opal.defn(self, '$slice', def['$[]']);

    def.$split = function(pattern, limit) {
      var $a, self = this;
      if ($gvars[";"] == null) $gvars[";"] = nil;

      if (pattern == null) {
        pattern = ((($a = $gvars[";"]) !== false && $a !== nil) ? $a : " ")
      }
      
      if (pattern === nil || pattern === undefined) {
        pattern = $gvars[";"];
      }

      var result = [];
      if (limit !== undefined) {
        limit = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a)['$coerce_to!'](limit, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
      }

      if (self.length === 0) {
        return [];
      }

      if (limit === 1) {
        return [self];
      }

      if (pattern && pattern._isRegexp) {
        var pattern_str = pattern.toString();

        /* Opal and JS's repr of an empty RE. */
        var blank_pattern = (pattern_str.substr(0, 3) == '/^/') ||
                  (pattern_str.substr(0, 6) == '/(?:)/');

        /* This is our fast path */
        if (limit === undefined || limit === 0) {
          result = self.split(blank_pattern ? /(?:)/ : pattern);
        }
        else {
          /* RegExp.exec only has sane behavior with global flag */
          if (! pattern.global) {
            pattern = eval(pattern_str + 'g');
          }

          var match_data;
          var prev_index = 0;
          pattern.lastIndex = 0;

          while ((match_data = pattern.exec(self)) !== null) {
            var segment = self.slice(prev_index, match_data.index);
            result.push(segment);

            prev_index = pattern.lastIndex;

            if (match_data[0].length === 0) {
              if (blank_pattern) {
                /* explicitly split on JS's empty RE form.*/
                pattern = /(?:)/;
              }

              result = self.split(pattern);
              /* with "unlimited", ruby leaves a trail on blanks. */
              if (limit !== undefined && limit < 0 && blank_pattern) {
                result.push('');
              }

              prev_index = undefined;
              break;
            }

            if (limit !== undefined && limit > 1 && result.length + 1 == limit) {
              break;
            }
          }

          if (prev_index !== undefined) {
            result.push(self.slice(prev_index, self.length));
          }
        }
      }
      else {
        var splitted = 0, start = 0, lim = 0;

        if (pattern === nil || pattern === undefined) {
          pattern = ' '
        } else {
          pattern = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$try_convert(pattern, (($a = $scope.String) == null ? $opal.cm('String') : $a), "to_str").$to_s();
        }

        var string = (pattern == ' ') ? self.replace(/[\r\n\t\v]\s+/g, ' ')
                                      : self;
        var cursor = -1;
        while ((cursor = string.indexOf(pattern, start)) > -1 && cursor < string.length) {
          if (splitted + 1 === limit) {
            break;
          }

          if (pattern == ' ' && cursor == start) {
            start = cursor + 1;
            continue;
          }

          result.push(string.substr(start, pattern.length ? cursor - start : 1));
          splitted++;

          start = cursor + (pattern.length ? pattern.length : 1);
        }

        if (string.length > 0 && (limit < 0 || string.length > start)) {
          if (string.length == start) {
            result.push('');
          }
          else {
            result.push(string.substr(start, string.length));
          }
        }
      }

      if (limit === undefined || limit === 0) {
        while (result[result.length-1] === '') {
          result.length = result.length - 1;
        }
      }

      if (limit > 0) {
        var tail = result.slice(limit - 1).join('');
        result.splice(limit - 1, result.length - 1, tail);
      }

      return result;
    ;
    };

    def.$squeeze = function(sets) {
      var $a, self = this;

      sets = $slice.call(arguments, 0);
      
      if (sets.length === 0) {
        return self.replace(/(.)\1+/g, '$1');
      }
    
      
      var set = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(sets[0], (($a = $scope.String) == null ? $opal.cm('String') : $a), "to_str").$chars();

      for (var i = 1, length = sets.length; i < length; i++) {
        set = (set)['$&']((($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(sets[i], (($a = $scope.String) == null ? $opal.cm('String') : $a), "to_str").$chars());
      }

      if (set.length === 0) {
        return self;
      }

      return self.replace(new RegExp("([" + (($a = $scope.Regexp) == null ? $opal.cm('Regexp') : $a).$escape((set).$join()) + "])\\1+", "g"), "$1");
    ;
    };

    def['$start_with?'] = function(prefixes) {
      var $a, self = this;

      prefixes = $slice.call(arguments, 0);
      
      for (var i = 0, length = prefixes.length; i < length; i++) {
        var prefix = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(prefixes[i], (($a = $scope.String) == null ? $opal.cm('String') : $a), "to_str").$to_s();

        if (self.indexOf(prefix) === 0) {
          return true;
        }
      }

      return false;
    
    };

    def.$strip = function() {
      var self = this;

      return self.replace(/^\s*/, '').replace(/\s*$/, '');
    };

    def.$sub = TMP_7 = function(pattern, replace) {
      var $a, self = this, $iter = TMP_7._p, block = $iter || nil;

      TMP_7._p = null;
      
      if (typeof(replace) === 'string') {
        // convert Ruby back reference to JavaScript back reference
        replace = replace.replace(/\\([1-9])/g, '$$$1')
        return self.replace(pattern, replace);
      }
      if (block !== nil) {
        return self.replace(pattern, function() {
          // FIXME: this should be a formal MatchData object with all the goodies
          var match_data = []
          for (var i = 0, len = arguments.length; i < len; i++) {
            var arg = arguments[i];
            if (arg == undefined) {
              match_data.push(nil);
            }
            else {
              match_data.push(arg);
            }
          }

          var str = match_data.pop();
          var offset = match_data.pop();
          var match_len = match_data.length;

          // $1, $2, $3 not being parsed correctly in Ruby code
          //for (var i = 1; i < match_len; i++) {
          //  __gvars[String(i)] = match_data[i];
          //}
          $gvars["&"] = match_data[0];
          $gvars["~"] = match_data;
          return block(match_data[0]);
        });
      }
      else if (replace !== undefined) {
        if (replace['$is_a?']((($a = $scope.Hash) == null ? $opal.cm('Hash') : $a))) {
          return self.replace(pattern, function(str) {
            var value = replace['$[]'](self.$str());

            return (value == null) ? nil : self.$value().$to_s();
          });
        }
        else {
          replace = (($a = $scope.String) == null ? $opal.cm('String') : $a).$try_convert(replace);

          if (replace == null) {
            self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "can't convert " + (replace.$class()) + " into String");
          }

          return self.replace(pattern, replace);
        }
      }
      else {
        // convert Ruby back reference to JavaScript back reference
        replace = replace.toString().replace(/\\([1-9])/g, '$$$1')
        return self.replace(pattern, replace);
      }
    ;
    };

    $opal.defn(self, '$succ', def.$next);

    def.$sum = function(n) {
      var self = this;

      if (n == null) {
        n = 16
      }
      
      var result = 0;

      for (var i = 0, length = self.length; i < length; i++) {
        result += (self.charCodeAt(i) % ((1 << n) - 1));
      }

      return result;
    
    };

    def.$swapcase = function() {
      var self = this;

      
      var str = self.replace(/([a-z]+)|([A-Z]+)/g, function($0,$1,$2) {
        return $1 ? $0.toUpperCase() : $0.toLowerCase();
      });

      if (self.constructor === String) {
        return str;
      }

      return self.$class().$new(str);
    
    };

    def.$to_f = function() {
      var self = this;

      
      if (self.charAt(0) === '_') {
        return 0;
      }

      var result = parseFloat(self.replace(/_/g, ''));

      if (isNaN(result) || result == Infinity || result == -Infinity) {
        return 0;
      }
      else {
        return result;
      }
    
    };

    def.$to_i = function(base) {
      var self = this;

      if (base == null) {
        base = 10
      }
      
      var result = parseInt(self, base);

      if (isNaN(result)) {
        return 0;
      }

      return result;
    
    };

    def.$to_proc = function() {
      var $a, $b, TMP_8, self = this;

      return ($a = ($b = self).$proc, $a._p = (TMP_8 = function(recv, args){var self = TMP_8._s || this, $a;
if (recv == null) recv = nil;args = $slice.call(arguments, 1);
      return ($a = recv).$send.apply($a, [self].concat(args))}, TMP_8._s = self, TMP_8), $a).call($b);
    };

    def.$to_s = function() {
      var self = this;

      return self.toString();
    };

    $opal.defn(self, '$to_str', def.$to_s);

    $opal.defn(self, '$to_sym', def.$intern);

    def.$tr = function(from, to) {
      var self = this;

      
      if (from.length == 0 || from === to) {
        return self;
      }

      var subs = {};
      var from_chars = from.split('');
      var from_length = from_chars.length;
      var to_chars = to.split('');
      var to_length = to_chars.length;

      var inverse = false;
      var global_sub = null;
      if (from_chars[0] === '^') {
        inverse = true;
        from_chars.shift();
        global_sub = to_chars[to_length - 1]
        from_length -= 1;
      }

      var from_chars_expanded = [];
      var last_from = null;
      var in_range = false;
      for (var i = 0; i < from_length; i++) {
        var ch = from_chars[i];
        if (last_from == null) {
          last_from = ch;
          from_chars_expanded.push(ch);
        }
        else if (ch === '-') {
          if (last_from === '-') {
            from_chars_expanded.push('-');
            from_chars_expanded.push('-');
          }
          else if (i == from_length - 1) {
            from_chars_expanded.push('-');
          }
          else {
            in_range = true;
          }
        }
        else if (in_range) {
          var start = last_from.charCodeAt(0) + 1;
          var end = ch.charCodeAt(0);
          for (var c = start; c < end; c++) {
            from_chars_expanded.push(String.fromCharCode(c));
          }
          from_chars_expanded.push(ch);
          in_range = null;
          last_from = null;
        }
        else {
          from_chars_expanded.push(ch);
        }
      }

      from_chars = from_chars_expanded;
      from_length = from_chars.length;

      if (inverse) {
        for (var i = 0; i < from_length; i++) {
          subs[from_chars[i]] = true;
        }
      }
      else {
        if (to_length > 0) {
          var to_chars_expanded = [];
          var last_to = null;
          var in_range = false;
          for (var i = 0; i < to_length; i++) {
            var ch = to_chars[i];
            if (last_from == null) {
              last_from = ch;
              to_chars_expanded.push(ch);
            }
            else if (ch === '-') {
              if (last_to === '-') {
                to_chars_expanded.push('-');
                to_chars_expanded.push('-');
              }
              else if (i == to_length - 1) {
                to_chars_expanded.push('-');
              }
              else {
                in_range = true;
              }
            }
            else if (in_range) {
              var start = last_from.charCodeAt(0) + 1;
              var end = ch.charCodeAt(0);
              for (var c = start; c < end; c++) {
                to_chars_expanded.push(String.fromCharCode(c));
              }
              to_chars_expanded.push(ch);
              in_range = null;
              last_from = null;
            }
            else {
              to_chars_expanded.push(ch);
            }
          }

          to_chars = to_chars_expanded;
          to_length = to_chars.length;
        }

        var length_diff = from_length - to_length;
        if (length_diff > 0) {
          var pad_char = (to_length > 0 ? to_chars[to_length - 1] : '');
          for (var i = 0; i < length_diff; i++) {
            to_chars.push(pad_char);
          }
        }

        for (var i = 0; i < from_length; i++) {
          subs[from_chars[i]] = to_chars[i];
        }
      }

      var new_str = ''
      for (var i = 0, length = self.length; i < length; i++) {
        var ch = self.charAt(i);
        var sub = subs[ch];
        if (inverse) {
          new_str += (sub == null ? global_sub : ch);
        }
        else {
          new_str += (sub != null ? sub : ch);
        }
      }
      return new_str;
    
    };

    def.$tr_s = function(from, to) {
      var self = this;

      
      if (from.length == 0) {
        return self;
      }

      var subs = {};
      var from_chars = from.split('');
      var from_length = from_chars.length;
      var to_chars = to.split('');
      var to_length = to_chars.length;

      var inverse = false;
      var global_sub = null;
      if (from_chars[0] === '^') {
        inverse = true;
        from_chars.shift();
        global_sub = to_chars[to_length - 1]
        from_length -= 1;
      }

      var from_chars_expanded = [];
      var last_from = null;
      var in_range = false;
      for (var i = 0; i < from_length; i++) {
        var ch = from_chars[i];
        if (last_from == null) {
          last_from = ch;
          from_chars_expanded.push(ch);
        }
        else if (ch === '-') {
          if (last_from === '-') {
            from_chars_expanded.push('-');
            from_chars_expanded.push('-');
          }
          else if (i == from_length - 1) {
            from_chars_expanded.push('-');
          }
          else {
            in_range = true;
          }
        }
        else if (in_range) {
          var start = last_from.charCodeAt(0) + 1;
          var end = ch.charCodeAt(0);
          for (var c = start; c < end; c++) {
            from_chars_expanded.push(String.fromCharCode(c));
          }
          from_chars_expanded.push(ch);
          in_range = null;
          last_from = null;
        }
        else {
          from_chars_expanded.push(ch);
        }
      }

      from_chars = from_chars_expanded;
      from_length = from_chars.length;

      if (inverse) {
        for (var i = 0; i < from_length; i++) {
          subs[from_chars[i]] = true;
        }
      }
      else {
        if (to_length > 0) {
          var to_chars_expanded = [];
          var last_to = null;
          var in_range = false;
          for (var i = 0; i < to_length; i++) {
            var ch = to_chars[i];
            if (last_from == null) {
              last_from = ch;
              to_chars_expanded.push(ch);
            }
            else if (ch === '-') {
              if (last_to === '-') {
                to_chars_expanded.push('-');
                to_chars_expanded.push('-');
              }
              else if (i == to_length - 1) {
                to_chars_expanded.push('-');
              }
              else {
                in_range = true;
              }
            }
            else if (in_range) {
              var start = last_from.charCodeAt(0) + 1;
              var end = ch.charCodeAt(0);
              for (var c = start; c < end; c++) {
                to_chars_expanded.push(String.fromCharCode(c));
              }
              to_chars_expanded.push(ch);
              in_range = null;
              last_from = null;
            }
            else {
              to_chars_expanded.push(ch);
            }
          }

          to_chars = to_chars_expanded;
          to_length = to_chars.length;
        }

        var length_diff = from_length - to_length;
        if (length_diff > 0) {
          var pad_char = (to_length > 0 ? to_chars[to_length - 1] : '');
          for (var i = 0; i < length_diff; i++) {
            to_chars.push(pad_char);
          }
        }

        for (var i = 0; i < from_length; i++) {
          subs[from_chars[i]] = to_chars[i];
        }
      }
      var new_str = ''
      var last_substitute = null
      for (var i = 0, length = self.length; i < length; i++) {
        var ch = self.charAt(i);
        var sub = subs[ch]
        if (inverse) {
          if (sub == null) {
            if (last_substitute == null) {
              new_str += global_sub;
              last_substitute = true;
            }
          }
          else {
            new_str += ch;
            last_substitute = null;
          }
        }
        else {
          if (sub != null) {
            if (last_substitute == null || last_substitute !== sub) {
              new_str += sub;
              last_substitute = sub;
            }
          }
          else {
            new_str += ch;
            last_substitute = null;
          }
        }
      }
      return new_str;
    
    };

    def.$upcase = function() {
      var self = this;

      return self.toUpperCase();
    };

    def.$freeze = function() {
      var self = this;

      return self;
    };

    return (def['$frozen?'] = function() {
      var self = this;

      return true;
    }, nil) && 'frozen?';
  })(self, null);
  return $opal.cdecl($scope, 'Symbol', (($a = $scope.String) == null ? $opal.cm('String') : $a));
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/string.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var $a, self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;

  $opal.add_stubs(['$new', '$allocate', '$initialize', '$to_proc', '$__send__', '$class', '$clone', '$respond_to?', '$==', '$inspect']);
  (function($base, $super) {
    function $String(){};
    var self = $String = $klass($base, $super, 'String', $String);

    var def = self._proto, $scope = self._scope;

    return ($opal.defs(self, '$inherited', function(klass) {
      var $a, $b, self = this, replace = nil;

      replace = (($a = $scope.Class) == null ? $opal.cm('Class') : $a).$new((($a = ((($b = $scope.String) == null ? $opal.cm('String') : $b))._scope).Wrapper == null ? $a.cm('Wrapper') : $a.Wrapper));
      
      klass._proto        = replace._proto;
      klass._proto._klass = klass;
      klass._alloc        = replace._alloc;
      klass.__parent      = (($a = ((($b = $scope.String) == null ? $opal.cm('String') : $b))._scope).Wrapper == null ? $a.cm('Wrapper') : $a.Wrapper);

      klass.$allocate = replace.$allocate;
      klass.$new      = replace.$new;
    
    }), nil) && 'inherited'
  })(self, null);
  return (function($base, $super) {
    function $Wrapper(){};
    var self = $Wrapper = $klass($base, $super, 'Wrapper', $Wrapper);

    var def = self._proto, $scope = self._scope, TMP_1, TMP_2, TMP_3, TMP_4;

    def.literal = nil;
    $opal.defs(self, '$allocate', TMP_1 = function(string) {
      var self = this, $iter = TMP_1._p, $yield = $iter || nil, obj = nil;

      if (string == null) {
        string = ""
      }
      TMP_1._p = null;
      obj = $opal.find_super_dispatcher(self, 'allocate', TMP_1, null, $Wrapper).apply(self, []);
      obj.literal = string;
      return obj;
    });

    $opal.defs(self, '$new', TMP_2 = function(args) {
      var $a, $b, self = this, $iter = TMP_2._p, block = $iter || nil, obj = nil;

      args = $slice.call(arguments, 0);
      TMP_2._p = null;
      obj = self.$allocate();
      ($a = ($b = obj).$initialize, $a._p = block.$to_proc(), $a).apply($b, [].concat(args));
      return obj;
    });

    $opal.defs(self, '$[]', function(objects) {
      var self = this;

      objects = $slice.call(arguments, 0);
      return self.$allocate(objects);
    });

    def.$initialize = function(string) {
      var self = this;

      if (string == null) {
        string = ""
      }
      return self.literal = string;
    };

    def.$method_missing = TMP_3 = function(args) {
      var $a, $b, self = this, $iter = TMP_3._p, block = $iter || nil, result = nil;

      args = $slice.call(arguments, 0);
      TMP_3._p = null;
      result = ($a = ($b = self.literal).$__send__, $a._p = block.$to_proc(), $a).apply($b, [].concat(args));
      if ((($a = result._isString != null) !== nil && (!$a._isBoolean || $a == true))) {
        if ((($a = result == self.literal) !== nil && (!$a._isBoolean || $a == true))) {
          return self
          } else {
          return self.$class().$allocate(result)
        }
        } else {
        return result
      };
    };

    def.$initialize_copy = function(other) {
      var self = this;

      return self.literal = (other.literal).$clone();
    };

    def['$respond_to?'] = TMP_4 = function(name) {var $zuper = $slice.call(arguments, 0);
      var $a, self = this, $iter = TMP_4._p, $yield = $iter || nil;

      TMP_4._p = null;
      return ((($a = $opal.find_super_dispatcher(self, 'respond_to?', TMP_4, $iter).apply(self, $zuper)) !== false && $a !== nil) ? $a : self.literal['$respond_to?'](name));
    };

    def['$=='] = function(other) {
      var self = this;

      return self.literal['$=='](other);
    };

    $opal.defn(self, '$eql?', def['$==']);

    $opal.defn(self, '$===', def['$==']);

    def.$to_s = function() {
      var self = this;

      return self.literal;
    };

    def.$to_str = function() {
      var self = this;

      return self;
    };

    return (def.$inspect = function() {
      var self = this;

      return self.literal.$inspect();
    }, nil) && 'inspect';
  })((($a = $scope.String) == null ? $opal.cm('String') : $a), null);
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/string/inheritance.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass, $gvars = $opal.gvars;

  $opal.add_stubs(['$attr_reader', '$pre_match', '$post_match', '$[]', '$===', '$!', '$==', '$raise', '$inspect']);
  return (function($base, $super) {
    function $MatchData(){};
    var self = $MatchData = $klass($base, $super, 'MatchData', $MatchData);

    var def = self._proto, $scope = self._scope, TMP_1;

    def.string = def.matches = def.begin = nil;
    self.$attr_reader("post_match", "pre_match", "regexp", "string");

    $opal.defs(self, '$new', TMP_1 = function(regexp, match_groups) {
      var self = this, $iter = TMP_1._p, $yield = $iter || nil, data = nil;

      TMP_1._p = null;
      data = $opal.find_super_dispatcher(self, 'new', TMP_1, null, $MatchData).apply(self, [regexp, match_groups]);
      $gvars["`"] = data.$pre_match();
      $gvars["'"] = data.$post_match();
      $gvars["~"] = data;
      return data;
    });

    def.$initialize = function(regexp, match_groups) {
      var self = this;

      self.regexp = regexp;
      self.begin = match_groups.index;
      self.string = match_groups.input;
      self.pre_match = self.string.substr(0, regexp.lastIndex - match_groups[0].length);
      self.post_match = self.string.substr(regexp.lastIndex);
      self.matches = [];
      
      for (var i = 0, length = match_groups.length; i < length; i++) {
        var group = match_groups[i];

        if (group == null) {
          self.matches.push(nil);
        }
        else {
          self.matches.push(group);
        }
      }
    
    };

    def['$[]'] = function(args) {
      var $a, self = this;

      args = $slice.call(arguments, 0);
      return ($a = self.matches)['$[]'].apply($a, [].concat(args));
    };

    def['$=='] = function(other) {
      var $a, $b, $c, $d, self = this;

      if ((($a = (($b = $scope.MatchData) == null ? $opal.cm('MatchData') : $b)['$==='](other)) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        return false
      };
      return ($a = ($b = ($c = ($d = self.string == other.string, $d !== false && $d !== nil ?self.regexp == other.regexp : $d), $c !== false && $c !== nil ?self.pre_match == other.pre_match : $c), $b !== false && $b !== nil ?self.post_match == other.post_match : $b), $a !== false && $a !== nil ?self.begin == other.begin : $a);
    };

    def.$begin = function(pos) {
      var $a, $b, self = this;

      if ((($a = ($b = pos['$=='](0)['$!'](), $b !== false && $b !== nil ?pos['$=='](1)['$!']() : $b)) !== nil && (!$a._isBoolean || $a == true))) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "MatchData#begin only supports 0th element")};
      return self.begin;
    };

    def.$captures = function() {
      var self = this;

      return self.matches.slice(1);
    };

    def.$inspect = function() {
      var self = this;

      
      var str = "#<MatchData " + (self.matches[0]).$inspect();

      for (var i = 1, length = self.matches.length; i < length; i++) {
        str += " " + i + ":" + (self.matches[i]).$inspect();
      }

      return str + ">";
    ;
    };

    def.$length = function() {
      var self = this;

      return self.matches.length;
    };

    $opal.defn(self, '$size', def.$length);

    def.$to_a = function() {
      var self = this;

      return self.matches;
    };

    def.$to_s = function() {
      var self = this;

      return self.matches[0];
    };

    return (def.$values_at = function(indexes) {
      var self = this;

      indexes = $slice.call(arguments, 0);
      
      var values       = [],
          match_length = self.matches.length;

      for (var i = 0, length = indexes.length; i < length; i++) {
        var pos = indexes[i];

        if (pos >= 0) {
          values.push(self.matches[pos]);
        }
        else {
          pos += match_length;

          if (pos > 0) {
            values.push(self.matches[pos]);
          }
          else {
            values.push(nil);
          }
        }
      }

      return values;
    ;
    }, nil) && 'values_at';
  })(self, null)
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/match_data.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var $a, self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;

  $opal.add_stubs(['$include', '$coerce', '$===', '$raise', '$class', '$__send__', '$send_coerced', '$to_int', '$coerce_to!', '$-@', '$**', '$-', '$respond_to?', '$==', '$enum_for', '$gcd', '$lcm', '$<', '$>', '$floor', '$/', '$%']);
  ;
  (function($base, $super) {
    function $Numeric(){};
    var self = $Numeric = $klass($base, $super, 'Numeric', $Numeric);

    var def = self._proto, $scope = self._scope, $a, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5, TMP_6;

    self.$include((($a = $scope.Comparable) == null ? $opal.cm('Comparable') : $a));

    def._isNumber = true;

    def.$coerce = function(other, type) {
      var $a, self = this, $case = nil;

      if (type == null) {
        type = "operation"
      }
      try {
      
      if (other._isNumber) {
        return [self, other];
      }
      else {
        return other.$coerce(self);
      }
    
      } catch ($err) {if (true) {
        return (function() {$case = type;if ("operation"['$===']($case)) {return self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "" + (other.$class()) + " can't be coerce into Numeric")}else if ("comparison"['$===']($case)) {return self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "comparison of " + (self.$class()) + " with " + (other.$class()) + " failed")}else { return nil }})()
        }else { throw $err; }
      };
    };

    def.$send_coerced = function(method, other) {
      var $a, self = this, type = nil, $case = nil, a = nil, b = nil;

      type = (function() {$case = method;if ("+"['$===']($case) || "-"['$===']($case) || "*"['$===']($case) || "/"['$===']($case) || "%"['$===']($case) || "&"['$===']($case) || "|"['$===']($case) || "^"['$===']($case) || "**"['$===']($case)) {return "operation"}else if (">"['$===']($case) || ">="['$===']($case) || "<"['$===']($case) || "<="['$===']($case) || "<=>"['$===']($case)) {return "comparison"}else { return nil }})();
      $a = $opal.to_ary(self.$coerce(other, type)), a = ($a[0] == null ? nil : $a[0]), b = ($a[1] == null ? nil : $a[1]);
      return a.$__send__(method, b);
    };

    def['$+'] = function(other) {
      var self = this;

      
      if (other._isNumber) {
        return self + other;
      }
      else {
        return self.$send_coerced("+", other);
      }
    
    };

    def['$-'] = function(other) {
      var self = this;

      
      if (other._isNumber) {
        return self - other;
      }
      else {
        return self.$send_coerced("-", other);
      }
    
    };

    def['$*'] = function(other) {
      var self = this;

      
      if (other._isNumber) {
        return self * other;
      }
      else {
        return self.$send_coerced("*", other);
      }
    
    };

    def['$/'] = function(other) {
      var self = this;

      
      if (other._isNumber) {
        return self / other;
      }
      else {
        return self.$send_coerced("/", other);
      }
    
    };

    def['$%'] = function(other) {
      var self = this;

      
      if (other._isNumber) {
        if (other < 0 || self < 0) {
          return (self % other + other) % other;
        }
        else {
          return self % other;
        }
      }
      else {
        return self.$send_coerced("%", other);
      }
    
    };

    def['$&'] = function(other) {
      var self = this;

      
      if (other._isNumber) {
        return self & other;
      }
      else {
        return self.$send_coerced("&", other);
      }
    
    };

    def['$|'] = function(other) {
      var self = this;

      
      if (other._isNumber) {
        return self | other;
      }
      else {
        return self.$send_coerced("|", other);
      }
    
    };

    def['$^'] = function(other) {
      var self = this;

      
      if (other._isNumber) {
        return self ^ other;
      }
      else {
        return self.$send_coerced("^", other);
      }
    
    };

    def['$<'] = function(other) {
      var self = this;

      
      if (other._isNumber) {
        return self < other;
      }
      else {
        return self.$send_coerced("<", other);
      }
    
    };

    def['$<='] = function(other) {
      var self = this;

      
      if (other._isNumber) {
        return self <= other;
      }
      else {
        return self.$send_coerced("<=", other);
      }
    
    };

    def['$>'] = function(other) {
      var self = this;

      
      if (other._isNumber) {
        return self > other;
      }
      else {
        return self.$send_coerced(">", other);
      }
    
    };

    def['$>='] = function(other) {
      var self = this;

      
      if (other._isNumber) {
        return self >= other;
      }
      else {
        return self.$send_coerced(">=", other);
      }
    
    };

    def['$<=>'] = function(other) {
      var $a, self = this;

      try {
      
      if (other._isNumber) {
        return self > other ? 1 : (self < other ? -1 : 0);
      }
      else {
        return self.$send_coerced("<=>", other);
      }
    
      } catch ($err) {if ($opal.$rescue($err, [(($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a)])) {
        return nil
        }else { throw $err; }
      };
    };

    def['$<<'] = function(count) {
      var self = this;

      return self << count.$to_int();
    };

    def['$>>'] = function(count) {
      var self = this;

      return self >> count.$to_int();
    };

    def['$[]'] = function(bit) {
      var $a, self = this, min = nil, max = nil;

      bit = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a)['$coerce_to!'](bit, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
      min = ((2)['$**'](30))['$-@']();
      max = ((2)['$**'](30))['$-'](1);
      return (bit < min || bit > max) ? 0 : (self >> bit) % 2;
    };

    def['$+@'] = function() {
      var self = this;

      return +self;
    };

    def['$-@'] = function() {
      var self = this;

      return -self;
    };

    def['$~'] = function() {
      var self = this;

      return ~self;
    };

    def['$**'] = function(other) {
      var self = this;

      
      if (other._isNumber) {
        return Math.pow(self, other);
      }
      else {
        return self.$send_coerced("**", other);
      }
    
    };

    def['$=='] = function(other) {
      var self = this;

      
      if (other._isNumber) {
        return self == Number(other);
      }
      else if (other['$respond_to?']("==")) {
        return other['$=='](self);
      }
      else {
        return false;
      }
    ;
    };

    def.$abs = function() {
      var self = this;

      return Math.abs(self);
    };

    def.$ceil = function() {
      var self = this;

      return Math.ceil(self);
    };

    def.$chr = function() {
      var self = this;

      return String.fromCharCode(self);
    };

    def.$conj = function() {
      var self = this;

      return self;
    };

    $opal.defn(self, '$conjugate', def.$conj);

    def.$downto = TMP_1 = function(finish) {
      var self = this, $iter = TMP_1._p, block = $iter || nil;

      TMP_1._p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("downto", finish)
      };
      
      for (var i = self; i >= finish; i--) {
        if (block(i) === $breaker) {
          return $breaker.$v;
        }
      }
    
      return self;
    };

    $opal.defn(self, '$eql?', def['$==']);

    $opal.defn(self, '$equal?', def['$==']);

    def['$even?'] = function() {
      var self = this;

      return self % 2 === 0;
    };

    def.$floor = function() {
      var self = this;

      return Math.floor(self);
    };

    def.$gcd = function(other) {
      var $a, $b, self = this;

      if ((($a = (($b = $scope.Integer) == null ? $opal.cm('Integer') : $b)['$==='](other)) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "not an integer")
      };
      
      var min = Math.abs(self),
          max = Math.abs(other);

      while (min > 0) {
        var tmp = min;

        min = max % min;
        max = tmp;
      }

      return max;
    
    };

    def.$gcdlcm = function(other) {
      var self = this;

      return [self.$gcd(), self.$lcm()];
    };

    def.$hash = function() {
      var self = this;

      return self.toString();
    };

    def['$integer?'] = function() {
      var self = this;

      return self % 1 === 0;
    };

    def['$is_a?'] = TMP_2 = function(klass) {var $zuper = $slice.call(arguments, 0);
      var $a, $b, $c, self = this, $iter = TMP_2._p, $yield = $iter || nil;

      TMP_2._p = null;
      if ((($a = (($b = klass['$==']((($c = $scope.Fixnum) == null ? $opal.cm('Fixnum') : $c))) ? (($c = $scope.Integer) == null ? $opal.cm('Integer') : $c)['$==='](self) : $b)) !== nil && (!$a._isBoolean || $a == true))) {
        return true};
      if ((($a = (($b = klass['$==']((($c = $scope.Integer) == null ? $opal.cm('Integer') : $c))) ? (($c = $scope.Integer) == null ? $opal.cm('Integer') : $c)['$==='](self) : $b)) !== nil && (!$a._isBoolean || $a == true))) {
        return true};
      if ((($a = (($b = klass['$==']((($c = $scope.Float) == null ? $opal.cm('Float') : $c))) ? (($c = $scope.Float) == null ? $opal.cm('Float') : $c)['$==='](self) : $b)) !== nil && (!$a._isBoolean || $a == true))) {
        return true};
      return $opal.find_super_dispatcher(self, 'is_a?', TMP_2, $iter).apply(self, $zuper);
    };

    $opal.defn(self, '$kind_of?', def['$is_a?']);

    def['$instance_of?'] = TMP_3 = function(klass) {var $zuper = $slice.call(arguments, 0);
      var $a, $b, $c, self = this, $iter = TMP_3._p, $yield = $iter || nil;

      TMP_3._p = null;
      if ((($a = (($b = klass['$==']((($c = $scope.Fixnum) == null ? $opal.cm('Fixnum') : $c))) ? (($c = $scope.Integer) == null ? $opal.cm('Integer') : $c)['$==='](self) : $b)) !== nil && (!$a._isBoolean || $a == true))) {
        return true};
      if ((($a = (($b = klass['$==']((($c = $scope.Integer) == null ? $opal.cm('Integer') : $c))) ? (($c = $scope.Integer) == null ? $opal.cm('Integer') : $c)['$==='](self) : $b)) !== nil && (!$a._isBoolean || $a == true))) {
        return true};
      if ((($a = (($b = klass['$==']((($c = $scope.Float) == null ? $opal.cm('Float') : $c))) ? (($c = $scope.Float) == null ? $opal.cm('Float') : $c)['$==='](self) : $b)) !== nil && (!$a._isBoolean || $a == true))) {
        return true};
      return $opal.find_super_dispatcher(self, 'instance_of?', TMP_3, $iter).apply(self, $zuper);
    };

    def.$lcm = function(other) {
      var $a, $b, self = this;

      if ((($a = (($b = $scope.Integer) == null ? $opal.cm('Integer') : $b)['$==='](other)) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "not an integer")
      };
      
      if (self == 0 || other == 0) {
        return 0;
      }
      else {
        return Math.abs(self * other / self.$gcd(other));
      }
    
    };

    $opal.defn(self, '$magnitude', def.$abs);

    $opal.defn(self, '$modulo', def['$%']);

    def.$next = function() {
      var self = this;

      return self + 1;
    };

    def['$nonzero?'] = function() {
      var self = this;

      return self == 0 ? nil : self;
    };

    def['$odd?'] = function() {
      var self = this;

      return self % 2 !== 0;
    };

    def.$ord = function() {
      var self = this;

      return self;
    };

    def.$pred = function() {
      var self = this;

      return self - 1;
    };

    def.$round = function() {
      var self = this;

      return Math.round(self);
    };

    def.$step = TMP_4 = function(limit, step) {
      var $a, self = this, $iter = TMP_4._p, block = $iter || nil;

      if (step == null) {
        step = 1
      }
      TMP_4._p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("step", limit, step)
      };
      if ((($a = step == 0) !== nil && (!$a._isBoolean || $a == true))) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "step cannot be 0")};
      
      var value = self;

      if (step > 0) {
        while (value <= limit) {
          block(value);
          value += step;
        }
      }
      else {
        while (value >= limit) {
          block(value);
          value += step;
        }
      }
    
      return self;
    };

    $opal.defn(self, '$succ', def.$next);

    def.$times = TMP_5 = function() {
      var self = this, $iter = TMP_5._p, block = $iter || nil;

      TMP_5._p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("times")
      };
      
      for (var i = 0; i < self; i++) {
        if (block(i) === $breaker) {
          return $breaker.$v;
        }
      }
    
      return self;
    };

    def.$to_f = function() {
      var self = this;

      return self;
    };

    def.$to_i = function() {
      var self = this;

      return parseInt(self);
    };

    $opal.defn(self, '$to_int', def.$to_i);

    def.$to_s = function(base) {
      var $a, $b, self = this;

      if (base == null) {
        base = 10
      }
      if ((($a = ((($b = base['$<'](2)) !== false && $b !== nil) ? $b : base['$>'](36))) !== nil && (!$a._isBoolean || $a == true))) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "base must be between 2 and 36")};
      return self.toString(base);
    };

    $opal.defn(self, '$inspect', def.$to_s);

    def.$divmod = function(rhs) {
      var self = this, q = nil, r = nil;

      q = (self['$/'](rhs)).$floor();
      r = self['$%'](rhs);
      return [q, r];
    };

    def.$upto = TMP_6 = function(finish) {
      var self = this, $iter = TMP_6._p, block = $iter || nil;

      TMP_6._p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("upto", finish)
      };
      
      for (var i = self; i <= finish; i++) {
        if (block(i) === $breaker) {
          return $breaker.$v;
        }
      }
    
      return self;
    };

    def['$zero?'] = function() {
      var self = this;

      return self == 0;
    };

    def.$size = function() {
      var self = this;

      return 4;
    };

    def['$nan?'] = function() {
      var self = this;

      return isNaN(self);
    };

    def['$finite?'] = function() {
      var self = this;

      return self != Infinity && self != -Infinity;
    };

    def['$infinite?'] = function() {
      var self = this;

      
      if (self == Infinity) {
        return +1;
      }
      else if (self == -Infinity) {
        return -1;
      }
      else {
        return nil;
      }
    
    };

    def['$positive?'] = function() {
      var self = this;

      return 1 / self > 0;
    };

    return (def['$negative?'] = function() {
      var self = this;

      return 1 / self < 0;
    }, nil) && 'negative?';
  })(self, null);
  $opal.cdecl($scope, 'Fixnum', (($a = $scope.Numeric) == null ? $opal.cm('Numeric') : $a));
  (function($base, $super) {
    function $Integer(){};
    var self = $Integer = $klass($base, $super, 'Integer', $Integer);

    var def = self._proto, $scope = self._scope;

    return ($opal.defs(self, '$===', function(other) {
      var self = this;

      
      if (!other._isNumber) {
        return false;
      }

      return (other % 1) === 0;
    
    }), nil) && '==='
  })(self, (($a = $scope.Numeric) == null ? $opal.cm('Numeric') : $a));
  return (function($base, $super) {
    function $Float(){};
    var self = $Float = $klass($base, $super, 'Float', $Float);

    var def = self._proto, $scope = self._scope, $a;

    $opal.defs(self, '$===', function(other) {
      var self = this;

      return !!other._isNumber;
    });

    $opal.cdecl($scope, 'INFINITY', Infinity);

    $opal.cdecl($scope, 'NAN', NaN);

    if ((($a = (typeof(Number.EPSILON) !== "undefined")) !== nil && (!$a._isBoolean || $a == true))) {
      return $opal.cdecl($scope, 'EPSILON', Number.EPSILON)
      } else {
      return $opal.cdecl($scope, 'EPSILON', 2.2204460492503130808472633361816E-16)
    };
  })(self, (($a = $scope.Numeric) == null ? $opal.cm('Numeric') : $a));
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/numeric.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var $a, self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;

  $opal.add_stubs([]);
  return (function($base, $super) {
    function $Complex(){};
    var self = $Complex = $klass($base, $super, 'Complex', $Complex);

    var def = self._proto, $scope = self._scope;

    return nil;
  })(self, (($a = $scope.Numeric) == null ? $opal.cm('Numeric') : $a))
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/complex.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var $a, self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;

  $opal.add_stubs([]);
  return (function($base, $super) {
    function $Rational(){};
    var self = $Rational = $klass($base, $super, 'Rational', $Rational);

    var def = self._proto, $scope = self._scope;

    return nil;
  })(self, (($a = $scope.Numeric) == null ? $opal.cm('Numeric') : $a))
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/rational.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;

  $opal.add_stubs(['$raise']);
  return (function($base, $super) {
    function $Proc(){};
    var self = $Proc = $klass($base, $super, 'Proc', $Proc);

    var def = self._proto, $scope = self._scope, TMP_1, TMP_2;

    def._isProc = true;

    def.is_lambda = false;

    $opal.defs(self, '$new', TMP_1 = function() {
      var $a, self = this, $iter = TMP_1._p, block = $iter || nil;

      TMP_1._p = null;
      if (block !== false && block !== nil) {
        } else {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "tried to create a Proc object without a block")
      };
      return block;
    });

    def.$call = TMP_2 = function(args) {
      var self = this, $iter = TMP_2._p, block = $iter || nil;

      args = $slice.call(arguments, 0);
      TMP_2._p = null;
      
      if (block !== nil) {
        self._p = block;
      }

      var result;

      if (self.is_lambda) {
        result = self.apply(null, args);
      }
      else {
        result = Opal.$yieldX(self, args);
      }

      if (result === $breaker) {
        return $breaker.$v;
      }

      return result;
    
    };

    $opal.defn(self, '$[]', def.$call);

    def.$to_proc = function() {
      var self = this;

      return self;
    };

    def['$lambda?'] = function() {
      var self = this;

      return !!self.is_lambda;
    };

    return (def.$arity = function() {
      var self = this;

      return self.length;
    }, nil) && 'arity';
  })(self, null)
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/proc.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;

  $opal.add_stubs(['$attr_reader', '$class', '$arity', '$new', '$name']);
  (function($base, $super) {
    function $Method(){};
    var self = $Method = $klass($base, $super, 'Method', $Method);

    var def = self._proto, $scope = self._scope, TMP_1;

    def.method = def.receiver = def.owner = def.name = def.obj = nil;
    self.$attr_reader("owner", "receiver", "name");

    def.$initialize = function(receiver, method, name) {
      var self = this;

      self.receiver = receiver;
      self.owner = receiver.$class();
      self.name = name;
      return self.method = method;
    };

    def.$arity = function() {
      var self = this;

      return self.method.$arity();
    };

    def.$call = TMP_1 = function(args) {
      var self = this, $iter = TMP_1._p, block = $iter || nil;

      args = $slice.call(arguments, 0);
      TMP_1._p = null;
      
      self.method._p = block;

      return self.method.apply(self.receiver, args);
    ;
    };

    $opal.defn(self, '$[]', def.$call);

    def.$unbind = function() {
      var $a, self = this;

      return (($a = $scope.UnboundMethod) == null ? $opal.cm('UnboundMethod') : $a).$new(self.owner, self.method, self.name);
    };

    def.$to_proc = function() {
      var self = this;

      return self.method;
    };

    return (def.$inspect = function() {
      var self = this;

      return "#<Method: " + (self.obj.$class().$name()) + "#" + (self.name) + "}>";
    }, nil) && 'inspect';
  })(self, null);
  return (function($base, $super) {
    function $UnboundMethod(){};
    var self = $UnboundMethod = $klass($base, $super, 'UnboundMethod', $UnboundMethod);

    var def = self._proto, $scope = self._scope;

    def.method = def.name = def.owner = nil;
    self.$attr_reader("owner", "name");

    def.$initialize = function(owner, method, name) {
      var self = this;

      self.owner = owner;
      self.method = method;
      return self.name = name;
    };

    def.$arity = function() {
      var self = this;

      return self.method.$arity();
    };

    def.$bind = function(object) {
      var $a, self = this;

      return (($a = $scope.Method) == null ? $opal.cm('Method') : $a).$new(object, self.method, self.name);
    };

    return (def.$inspect = function() {
      var self = this;

      return "#<UnboundMethod: " + (self.owner.$name()) + "#" + (self.name) + ">";
    }, nil) && 'inspect';
  })(self, null);
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/method.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;

  $opal.add_stubs(['$include', '$attr_reader', '$<=', '$<', '$enum_for', '$succ', '$!', '$==', '$===', '$exclude_end?', '$eql?', '$begin', '$end', '$-', '$abs', '$to_i', '$raise', '$inspect']);
  ;
  return (function($base, $super) {
    function $Range(){};
    var self = $Range = $klass($base, $super, 'Range', $Range);

    var def = self._proto, $scope = self._scope, $a, TMP_1, TMP_2, TMP_3;

    def.begin = def.exclude = def.end = nil;
    self.$include((($a = $scope.Enumerable) == null ? $opal.cm('Enumerable') : $a));

    def._isRange = true;

    self.$attr_reader("begin", "end");

    def.$initialize = function(first, last, exclude) {
      var self = this;

      if (exclude == null) {
        exclude = false
      }
      self.begin = first;
      self.end = last;
      return self.exclude = exclude;
    };

    def['$=='] = function(other) {
      var self = this;

      
      if (!other._isRange) {
        return false;
      }

      return self.exclude === other.exclude &&
             self.begin   ==  other.begin &&
             self.end     ==  other.end;
    
    };

    def['$==='] = function(value) {
      var $a, $b, self = this;

      return (($a = self.begin['$<='](value)) ? ((function() {if ((($b = self.exclude) !== nil && (!$b._isBoolean || $b == true))) {
        return value['$<'](self.end)
        } else {
        return value['$<='](self.end)
      }; return nil; })()) : $a);
    };

    $opal.defn(self, '$cover?', def['$===']);

    def.$each = TMP_1 = function() {
      var $a, $b, self = this, $iter = TMP_1._p, block = $iter || nil, current = nil, last = nil;

      TMP_1._p = null;
      if ((block !== nil)) {
        } else {
        return self.$enum_for("each")
      };
      current = self.begin;
      last = self.end;
      while (current['$<'](last)) {
      if ($opal.$yield1(block, current) === $breaker) return $breaker.$v;
      current = current.$succ();};
      if ((($a = ($b = self.exclude['$!'](), $b !== false && $b !== nil ?current['$=='](last) : $b)) !== nil && (!$a._isBoolean || $a == true))) {
        if ($opal.$yield1(block, current) === $breaker) return $breaker.$v};
      return self;
    };

    def['$eql?'] = function(other) {
      var $a, $b, self = this;

      if ((($a = (($b = $scope.Range) == null ? $opal.cm('Range') : $b)['$==='](other)) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        return false
      };
      return ($a = ($b = self.exclude['$==='](other['$exclude_end?']()), $b !== false && $b !== nil ?self.begin['$eql?'](other.$begin()) : $b), $a !== false && $a !== nil ?self.end['$eql?'](other.$end()) : $a);
    };

    def['$exclude_end?'] = function() {
      var self = this;

      return self.exclude;
    };

    $opal.defn(self, '$first', def.$begin);

    $opal.defn(self, '$include?', def['$cover?']);

    $opal.defn(self, '$last', def.$end);

    def.$max = TMP_2 = function() {var $zuper = $slice.call(arguments, 0);
      var self = this, $iter = TMP_2._p, $yield = $iter || nil;

      TMP_2._p = null;
      if (($yield !== nil)) {
        return $opal.find_super_dispatcher(self, 'max', TMP_2, $iter).apply(self, $zuper)
        } else {
        return self.exclude ? self.end - 1 : self.end;
      };
    };

    $opal.defn(self, '$member?', def['$cover?']);

    def.$min = TMP_3 = function() {var $zuper = $slice.call(arguments, 0);
      var self = this, $iter = TMP_3._p, $yield = $iter || nil;

      TMP_3._p = null;
      if (($yield !== nil)) {
        return $opal.find_super_dispatcher(self, 'min', TMP_3, $iter).apply(self, $zuper)
        } else {
        return self.begin
      };
    };

    $opal.defn(self, '$member?', def['$include?']);

    def.$size = function() {
      var $a, $b, $c, self = this, _begin = nil, _end = nil, infinity = nil;

      _begin = self.begin;
      _end = self.end;
      if ((($a = self.exclude) !== nil && (!$a._isBoolean || $a == true))) {
        _end = _end['$-'](1)};
      if ((($a = ($b = (($c = $scope.Numeric) == null ? $opal.cm('Numeric') : $c)['$==='](_begin), $b !== false && $b !== nil ?(($c = $scope.Numeric) == null ? $opal.cm('Numeric') : $c)['$==='](_end) : $b)) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        return nil
      };
      if (_end['$<'](_begin)) {
        return 0};
      infinity = (($a = ((($b = $scope.Float) == null ? $opal.cm('Float') : $b))._scope).INFINITY == null ? $a.cm('INFINITY') : $a.INFINITY);
      if ((($a = ((($b = infinity['$=='](_begin.$abs())) !== false && $b !== nil) ? $b : _end.$abs()['$=='](infinity))) !== nil && (!$a._isBoolean || $a == true))) {
        return infinity};
      return ((Math.abs(_end - _begin) + 1)).$to_i();
    };

    def.$step = function(n) {
      var $a, self = this;

      if (n == null) {
        n = 1
      }
      return self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
    };

    def.$to_s = function() {
      var self = this;

      return self.begin.$inspect() + (self.exclude ? '...' : '..') + self.end.$inspect();
    };

    return $opal.defn(self, '$inspect', def.$to_s);
  })(self, null);
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/range.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;

  $opal.add_stubs(['$include', '$kind_of?', '$to_i', '$coerce_to', '$between?', '$raise', '$new', '$compact', '$nil?', '$===', '$<=>', '$to_f', '$strftime', '$is_a?', '$zero?', '$utc?', '$warn', '$yday', '$rjust', '$ljust', '$zone', '$sec', '$min', '$hour', '$day', '$month', '$year', '$wday', '$isdst']);
  ;
  return (function($base, $super) {
    function $Time(){};
    var self = $Time = $klass($base, $super, 'Time', $Time);

    var def = self._proto, $scope = self._scope, $a;

    self.$include((($a = $scope.Comparable) == null ? $opal.cm('Comparable') : $a));

    
    var days_of_week = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
        short_days   = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
        short_months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
        long_months  = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  ;

    $opal.defs(self, '$at', function(seconds, frac) {
      var self = this;

      if (frac == null) {
        frac = 0
      }
      return new Date(seconds * 1000 + frac);
    });

    $opal.defs(self, '$new', function(year, month, day, hour, minute, second, utc_offset) {
      var self = this;

      
      switch (arguments.length) {
        case 1:
          return new Date(year, 0);

        case 2:
          return new Date(year, month - 1);

        case 3:
          return new Date(year, month - 1, day);

        case 4:
          return new Date(year, month - 1, day, hour);

        case 5:
          return new Date(year, month - 1, day, hour, minute);

        case 6:
          return new Date(year, month - 1, day, hour, minute, second);

        case 7:
          return new Date(year, month - 1, day, hour, minute, second);

        default:
          return new Date();
      }
    
    });

    $opal.defs(self, '$local', function(year, month, day, hour, minute, second, millisecond) {
      var $a, $b, self = this;

      if (month == null) {
        month = nil
      }
      if (day == null) {
        day = nil
      }
      if (hour == null) {
        hour = nil
      }
      if (minute == null) {
        minute = nil
      }
      if (second == null) {
        second = nil
      }
      if (millisecond == null) {
        millisecond = nil
      }
      if ((($a = arguments.length === 10) !== nil && (!$a._isBoolean || $a == true))) {
        
        var args = $slice.call(arguments).reverse();

        second = args[9];
        minute = args[8];
        hour   = args[7];
        day    = args[6];
        month  = args[5];
        year   = args[4];
      };
      year = (function() {if ((($a = year['$kind_of?']((($b = $scope.String) == null ? $opal.cm('String') : $b))) !== nil && (!$a._isBoolean || $a == true))) {
        return year.$to_i()
        } else {
        return (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(year, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int")
      }; return nil; })();
      month = (function() {if ((($a = month['$kind_of?']((($b = $scope.String) == null ? $opal.cm('String') : $b))) !== nil && (!$a._isBoolean || $a == true))) {
        return month.$to_i()
        } else {
        return (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(((($a = month) !== false && $a !== nil) ? $a : 1), (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int")
      }; return nil; })();
      if ((($a = month['$between?'](1, 12)) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "month out of range: " + (month))
      };
      day = (function() {if ((($a = day['$kind_of?']((($b = $scope.String) == null ? $opal.cm('String') : $b))) !== nil && (!$a._isBoolean || $a == true))) {
        return day.$to_i()
        } else {
        return (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(((($a = day) !== false && $a !== nil) ? $a : 1), (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int")
      }; return nil; })();
      if ((($a = day['$between?'](1, 31)) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "day out of range: " + (day))
      };
      hour = (function() {if ((($a = hour['$kind_of?']((($b = $scope.String) == null ? $opal.cm('String') : $b))) !== nil && (!$a._isBoolean || $a == true))) {
        return hour.$to_i()
        } else {
        return (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(((($a = hour) !== false && $a !== nil) ? $a : 0), (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int")
      }; return nil; })();
      if ((($a = hour['$between?'](0, 24)) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "hour out of range: " + (hour))
      };
      minute = (function() {if ((($a = minute['$kind_of?']((($b = $scope.String) == null ? $opal.cm('String') : $b))) !== nil && (!$a._isBoolean || $a == true))) {
        return minute.$to_i()
        } else {
        return (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(((($a = minute) !== false && $a !== nil) ? $a : 0), (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int")
      }; return nil; })();
      if ((($a = minute['$between?'](0, 59)) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "minute out of range: " + (minute))
      };
      second = (function() {if ((($a = second['$kind_of?']((($b = $scope.String) == null ? $opal.cm('String') : $b))) !== nil && (!$a._isBoolean || $a == true))) {
        return second.$to_i()
        } else {
        return (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(((($a = second) !== false && $a !== nil) ? $a : 0), (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int")
      }; return nil; })();
      if ((($a = second['$between?'](0, 59)) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "second out of range: " + (second))
      };
      return ($a = self).$new.apply($a, [].concat([year, month, day, hour, minute, second].$compact()));
    });

    $opal.defs(self, '$gm', function(year, month, day, hour, minute, second, utc_offset) {
      var $a, self = this;

      if ((($a = year['$nil?']()) !== nil && (!$a._isBoolean || $a == true))) {
        self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "missing year (got nil)")};
      
      if (month > 12 || day > 31 || hour > 24 || minute > 59 || second > 59) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a));
      }

      var date = new Date(Date.UTC(year, (month || 1) - 1, (day || 1), (hour || 0), (minute || 0), (second || 0)));
      date.tz_offset = 0
      return date;
    ;
    });

    (function(self) {
      var $scope = self._scope, def = self._proto;

      self._proto.$mktime = self._proto.$local;
      return self._proto.$utc = self._proto.$gm;
    })(self.$singleton_class());

    $opal.defs(self, '$now', function() {
      var self = this;

      return new Date();
    });

    def['$+'] = function(other) {
      var $a, $b, self = this;

      if ((($a = (($b = $scope.Time) == null ? $opal.cm('Time') : $b)['$==='](other)) !== nil && (!$a._isBoolean || $a == true))) {
        self.$raise((($a = $scope.TypeError) == null ? $opal.cm('TypeError') : $a), "time + time?")};
      other = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(other, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
      
      var result = new Date(self.getTime() + (other * 1000));
      result.tz_offset = self.tz_offset;
      return result;
    
    };

    def['$-'] = function(other) {
      var $a, $b, self = this;

      if ((($a = (($b = $scope.Time) == null ? $opal.cm('Time') : $b)['$==='](other)) !== nil && (!$a._isBoolean || $a == true))) {
        return (self.getTime() - other.getTime()) / 1000;
        } else {
        other = (($a = $scope.Opal) == null ? $opal.cm('Opal') : $a).$coerce_to(other, (($a = $scope.Integer) == null ? $opal.cm('Integer') : $a), "to_int");
        
        var result = new Date(self.getTime() - (other * 1000));
        result.tz_offset = self.tz_offset;
        return result;
      
      };
    };

    def['$<=>'] = function(other) {
      var self = this;

      return self.$to_f()['$<=>'](other.$to_f());
    };

    def['$=='] = function(other) {
      var self = this;

      return self.$to_f() === other.$to_f();
    };

    def.$asctime = function() {
      var self = this;

      return self.$strftime("%a %b %e %H:%M:%S %Y");
    };

    $opal.defn(self, '$ctime', def.$asctime);

    def.$day = function() {
      var self = this;

      return self.getDate();
    };

    def.$yday = function() {
      var self = this;

      
      // http://javascript.about.com/library/bldayyear.htm
      var onejan = new Date(self.getFullYear(), 0, 1);
      return Math.ceil((self - onejan) / 86400000);
    
    };

    def.$isdst = function() {
      var $a, self = this;

      return self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
    };

    def['$eql?'] = function(other) {
      var $a, $b, self = this;

      return ($a = other['$is_a?']((($b = $scope.Time) == null ? $opal.cm('Time') : $b)), $a !== false && $a !== nil ?(self['$<=>'](other))['$zero?']() : $a);
    };

    def['$friday?'] = function() {
      var self = this;

      return self.getDay() === 5;
    };

    def.$hour = function() {
      var self = this;

      return self.getHours();
    };

    def.$inspect = function() {
      var $a, self = this;

      if ((($a = self['$utc?']()) !== nil && (!$a._isBoolean || $a == true))) {
        return self.$strftime("%Y-%m-%d %H:%M:%S UTC")
        } else {
        return self.$strftime("%Y-%m-%d %H:%M:%S %z")
      };
    };

    $opal.defn(self, '$mday', def.$day);

    def.$min = function() {
      var self = this;

      return self.getMinutes();
    };

    def.$mon = function() {
      var self = this;

      return self.getMonth() + 1;
    };

    def['$monday?'] = function() {
      var self = this;

      return self.getDay() === 1;
    };

    $opal.defn(self, '$month', def.$mon);

    def['$saturday?'] = function() {
      var self = this;

      return self.getDay() === 6;
    };

    def.$sec = function() {
      var self = this;

      return self.getSeconds();
    };

    def.$usec = function() {
      var self = this;

      self.$warn("Microseconds are not supported");
      return 0;
    };

    def.$zone = function() {
      var self = this;

      
      var string = self.toString(),
          result;

      if (string.indexOf('(') == -1) {
        result = string.match(/[A-Z]{3,4}/)[0];
      }
      else {
        result = string.match(/\([^)]+\)/)[0].match(/[A-Z]/g).join('');
      }

      if (result == "GMT" && /(GMT\W*\d{4})/.test(string)) {
        return RegExp.$1;
      }
      else {
        return result;
      }
    
    };

    def.$getgm = function() {
      var self = this;

      
      var result = new Date(self.getTime());
      result.tz_offset = 0;
      return result;
    
    };

    def['$gmt?'] = function() {
      var self = this;

      return self.tz_offset == 0;
    };

    def.$gmt_offset = function() {
      var self = this;

      return -self.getTimezoneOffset() * 60;
    };

    def.$strftime = function(format) {
      var self = this;

      
      return format.replace(/%([\-_#^0]*:{0,2})(\d+)?([EO]*)(.)/g, function(full, flags, width, _, conv) {
        var result = "",
            width  = parseInt(width),
            zero   = flags.indexOf('0') !== -1,
            pad    = flags.indexOf('-') === -1,
            blank  = flags.indexOf('_') !== -1,
            upcase = flags.indexOf('^') !== -1,
            invert = flags.indexOf('#') !== -1,
            colons = (flags.match(':') || []).length;

        if (zero && blank) {
          if (flags.indexOf('0') < flags.indexOf('_')) {
            zero = false;
          }
          else {
            blank = false;
          }
        }

        switch (conv) {
          case 'Y':
            result += self.getFullYear();
            break;

          case 'C':
            zero    = !blank;
            result += Match.round(self.getFullYear() / 100);
            break;

          case 'y':
            zero    = !blank;
            result += (self.getFullYear() % 100);
            break;

          case 'm':
            zero    = !blank;
            result += (self.getMonth() + 1);
            break;

          case 'B':
            result += long_months[self.getMonth()];
            break;

          case 'b':
          case 'h':
            blank   = !zero;
            result += short_months[self.getMonth()];
            break;

          case 'd':
            zero    = !blank
            result += self.getDate();
            break;

          case 'e':
            blank   = !zero
            result += self.getDate();
            break;

          case 'j':
            result += self.$yday();
            break;

          case 'H':
            zero    = !blank;
            result += self.getHours();
            break;

          case 'k':
            blank   = !zero;
            result += self.getHours();
            break;

          case 'I':
            zero    = !blank;
            result += (self.getHours() % 12 || 12);
            break;

          case 'l':
            blank   = !zero;
            result += (self.getHours() % 12 || 12);
            break;

          case 'P':
            result += (self.getHours() >= 12 ? "pm" : "am");
            break;

          case 'p':
            result += (self.getHours() >= 12 ? "PM" : "AM");
            break;

          case 'M':
            zero    = !blank;
            result += self.getMinutes();
            break;

          case 'S':
            zero    = !blank;
            result += self.getSeconds();
            break;

          case 'L':
            zero    = !blank;
            width   = isNaN(width) ? 3 : width;
            result += self.getMilliseconds();
            break;

          case 'N':
            width   = isNaN(width) ? 9 : width;
            result += (self.getMilliseconds().toString()).$rjust(3, "0");
            result  = (result).$ljust(width, "0");
            break;

          case 'z':
            var offset  = self.getTimezoneOffset(),
                hours   = Math.floor(Math.abs(offset) / 60),
                minutes = Math.abs(offset) % 60;

            result += offset < 0 ? "+" : "-";
            result += hours < 10 ? "0" : "";
            result += hours;

            if (colons > 0) {
              result += ":";
            }

            result += minutes < 10 ? "0" : "";
            result += minutes;

            if (colons > 1) {
              result += ":00";
            }

            break;

          case 'Z':
            result += self.$zone();
            break;

          case 'A':
            result += days_of_week[self.getDay()];
            break;

          case 'a':
            result += short_days[self.getDay()];
            break;

          case 'u':
            result += (self.getDay() + 1);
            break;

          case 'w':
            result += self.getDay();
            break;

          // TODO: week year
          // TODO: week number

          case 's':
            result += parseInt(self.getTime() / 1000)
            break;

          case 'n':
            result += "\n";
            break;

          case 't':
            result += "\t";
            break;

          case '%':
            result += "%";
            break;

          case 'c':
            result += self.$strftime("%a %b %e %T %Y");
            break;

          case 'D':
          case 'x':
            result += self.$strftime("%m/%d/%y");
            break;

          case 'F':
            result += self.$strftime("%Y-%m-%d");
            break;

          case 'v':
            result += self.$strftime("%e-%^b-%4Y");
            break;

          case 'r':
            result += self.$strftime("%I:%M:%S %p");
            break;

          case 'R':
            result += self.$strftime("%H:%M");
            break;

          case 'T':
          case 'X':
            result += self.$strftime("%H:%M:%S");
            break;

          default:
            return full;
        }

        if (upcase) {
          result = result.toUpperCase();
        }

        if (invert) {
          result = result.replace(/[A-Z]/, function(c) { c.toLowerCase() }).
                          replace(/[a-z]/, function(c) { c.toUpperCase() });
        }

        if (pad && (zero || blank)) {
          result = (result).$rjust(isNaN(width) ? 2 : width, blank ? " " : "0");
        }

        return result;
      });
    
    };

    def['$sunday?'] = function() {
      var self = this;

      return self.getDay() === 0;
    };

    def['$thursday?'] = function() {
      var self = this;

      return self.getDay() === 4;
    };

    def.$to_a = function() {
      var self = this;

      return [self.$sec(), self.$min(), self.$hour(), self.$day(), self.$month(), self.$year(), self.$wday(), self.$yday(), self.$isdst(), self.$zone()];
    };

    def.$to_f = function() {
      var self = this;

      return self.getTime() / 1000;
    };

    def.$to_i = function() {
      var self = this;

      return parseInt(self.getTime() / 1000);
    };

    $opal.defn(self, '$to_s', def.$inspect);

    def['$tuesday?'] = function() {
      var self = this;

      return self.getDay() === 2;
    };

    $opal.defn(self, '$utc?', def['$gmt?']);

    def.$utc_offset = function() {
      var self = this;

      return self.getTimezoneOffset() * -60;
    };

    def.$wday = function() {
      var self = this;

      return self.getDay();
    };

    def['$wednesday?'] = function() {
      var self = this;

      return self.getDay() === 3;
    };

    return (def.$year = function() {
      var self = this;

      return self.getFullYear();
    }, nil) && 'year';
  })(self, null);
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/time.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;

  $opal.add_stubs(['$==', '$[]', '$upcase', '$const_set', '$new', '$unshift', '$each', '$define_struct_attribute', '$instance_eval', '$to_proc', '$raise', '$<<', '$members', '$define_method', '$instance_variable_get', '$instance_variable_set', '$include', '$each_with_index', '$class', '$===', '$>=', '$size', '$include?', '$to_sym', '$enum_for', '$hash', '$all?', '$length', '$map', '$+', '$name', '$join', '$inspect', '$each_pair']);
  return (function($base, $super) {
    function $Struct(){};
    var self = $Struct = $klass($base, $super, 'Struct', $Struct);

    var def = self._proto, $scope = self._scope, TMP_1, $a, TMP_8, TMP_10;

    $opal.defs(self, '$new', TMP_1 = function(name, args) {var $zuper = $slice.call(arguments, 0);
      var $a, $b, $c, TMP_2, $d, self = this, $iter = TMP_1._p, block = $iter || nil;

      args = $slice.call(arguments, 1);
      TMP_1._p = null;
      if (self['$==']((($a = $scope.Struct) == null ? $opal.cm('Struct') : $a))) {
        } else {
        return $opal.find_super_dispatcher(self, 'new', TMP_1, $iter, $Struct).apply(self, $zuper)
      };
      if (name['$[]'](0)['$=='](name['$[]'](0).$upcase())) {
        return (($a = $scope.Struct) == null ? $opal.cm('Struct') : $a).$const_set(name, ($a = self).$new.apply($a, [].concat(args)))
        } else {
        args.$unshift(name);
        return ($b = ($c = (($d = $scope.Class) == null ? $opal.cm('Class') : $d)).$new, $b._p = (TMP_2 = function(){var self = TMP_2._s || this, $a, $b, TMP_3, $c;

        ($a = ($b = args).$each, $a._p = (TMP_3 = function(arg){var self = TMP_3._s || this;
if (arg == null) arg = nil;
          return self.$define_struct_attribute(arg)}, TMP_3._s = self, TMP_3), $a).call($b);
          if (block !== false && block !== nil) {
            return ($a = ($c = self).$instance_eval, $a._p = block.$to_proc(), $a).call($c)
            } else {
            return nil
          };}, TMP_2._s = self, TMP_2), $b).call($c, self);
      };
    });

    $opal.defs(self, '$define_struct_attribute', function(name) {
      var $a, $b, TMP_4, $c, TMP_5, self = this;

      if (self['$==']((($a = $scope.Struct) == null ? $opal.cm('Struct') : $a))) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "you cannot define attributes to the Struct class")};
      self.$members()['$<<'](name);
      ($a = ($b = self).$define_method, $a._p = (TMP_4 = function(){var self = TMP_4._s || this;

      return self.$instance_variable_get("@" + (name))}, TMP_4._s = self, TMP_4), $a).call($b, name);
      return ($a = ($c = self).$define_method, $a._p = (TMP_5 = function(value){var self = TMP_5._s || this;
if (value == null) value = nil;
      return self.$instance_variable_set("@" + (name), value)}, TMP_5._s = self, TMP_5), $a).call($c, "" + (name) + "=");
    });

    $opal.defs(self, '$members', function() {
      var $a, self = this;
      if (self.members == null) self.members = nil;

      if (self['$==']((($a = $scope.Struct) == null ? $opal.cm('Struct') : $a))) {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "the Struct class has no members")};
      return ((($a = self.members) !== false && $a !== nil) ? $a : self.members = []);
    });

    $opal.defs(self, '$inherited', function(klass) {
      var $a, $b, TMP_6, self = this, members = nil;
      if (self.members == null) self.members = nil;

      if (self['$==']((($a = $scope.Struct) == null ? $opal.cm('Struct') : $a))) {
        return nil};
      members = self.members;
      return ($a = ($b = klass).$instance_eval, $a._p = (TMP_6 = function(){var self = TMP_6._s || this;

      return self.members = members}, TMP_6._s = self, TMP_6), $a).call($b);
    });

    (function(self) {
      var $scope = self._scope, def = self._proto;

      return self._proto['$[]'] = self._proto.$new
    })(self.$singleton_class());

    self.$include((($a = $scope.Enumerable) == null ? $opal.cm('Enumerable') : $a));

    def.$initialize = function(args) {
      var $a, $b, TMP_7, self = this;

      args = $slice.call(arguments, 0);
      return ($a = ($b = self.$members()).$each_with_index, $a._p = (TMP_7 = function(name, index){var self = TMP_7._s || this;
if (name == null) name = nil;if (index == null) index = nil;
      return self.$instance_variable_set("@" + (name), args['$[]'](index))}, TMP_7._s = self, TMP_7), $a).call($b);
    };

    def.$members = function() {
      var self = this;

      return self.$class().$members();
    };

    def['$[]'] = function(name) {
      var $a, $b, self = this;

      if ((($a = (($b = $scope.Integer) == null ? $opal.cm('Integer') : $b)['$==='](name)) !== nil && (!$a._isBoolean || $a == true))) {
        if (name['$>='](self.$members().$size())) {
          self.$raise((($a = $scope.IndexError) == null ? $opal.cm('IndexError') : $a), "offset " + (name) + " too large for struct(size:" + (self.$members().$size()) + ")")};
        name = self.$members()['$[]'](name);
      } else if ((($a = self.$members()['$include?'](name.$to_sym())) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        self.$raise((($a = $scope.NameError) == null ? $opal.cm('NameError') : $a), "no member '" + (name) + "' in struct")
      };
      return self.$instance_variable_get("@" + (name));
    };

    def['$[]='] = function(name, value) {
      var $a, $b, self = this;

      if ((($a = (($b = $scope.Integer) == null ? $opal.cm('Integer') : $b)['$==='](name)) !== nil && (!$a._isBoolean || $a == true))) {
        if (name['$>='](self.$members().$size())) {
          self.$raise((($a = $scope.IndexError) == null ? $opal.cm('IndexError') : $a), "offset " + (name) + " too large for struct(size:" + (self.$members().$size()) + ")")};
        name = self.$members()['$[]'](name);
      } else if ((($a = self.$members()['$include?'](name.$to_sym())) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        self.$raise((($a = $scope.NameError) == null ? $opal.cm('NameError') : $a), "no member '" + (name) + "' in struct")
      };
      return self.$instance_variable_set("@" + (name), value);
    };

    def.$each = TMP_8 = function() {
      var $a, $b, TMP_9, self = this, $iter = TMP_8._p, $yield = $iter || nil;

      TMP_8._p = null;
      if (($yield !== nil)) {
        } else {
        return self.$enum_for("each")
      };
      ($a = ($b = self.$members()).$each, $a._p = (TMP_9 = function(name){var self = TMP_9._s || this, $a;
if (name == null) name = nil;
      return $a = $opal.$yield1($yield, self['$[]'](name)), $a === $breaker ? $a : $a}, TMP_9._s = self, TMP_9), $a).call($b);
      return self;
    };

    def.$each_pair = TMP_10 = function() {
      var $a, $b, TMP_11, self = this, $iter = TMP_10._p, $yield = $iter || nil;

      TMP_10._p = null;
      if (($yield !== nil)) {
        } else {
        return self.$enum_for("each_pair")
      };
      ($a = ($b = self.$members()).$each, $a._p = (TMP_11 = function(name){var self = TMP_11._s || this, $a;
if (name == null) name = nil;
      return $a = $opal.$yieldX($yield, [name, self['$[]'](name)]), $a === $breaker ? $a : $a}, TMP_11._s = self, TMP_11), $a).call($b);
      return self;
    };

    def['$eql?'] = function(other) {
      var $a, $b, $c, TMP_12, self = this;

      return ((($a = self.$hash()['$=='](other.$hash())) !== false && $a !== nil) ? $a : ($b = ($c = other.$each_with_index())['$all?'], $b._p = (TMP_12 = function(object, index){var self = TMP_12._s || this;
if (object == null) object = nil;if (index == null) index = nil;
      return self['$[]'](self.$members()['$[]'](index))['$=='](object)}, TMP_12._s = self, TMP_12), $b).call($c));
    };

    def.$length = function() {
      var self = this;

      return self.$members().$length();
    };

    $opal.defn(self, '$size', def.$length);

    def.$to_a = function() {
      var $a, $b, TMP_13, self = this;

      return ($a = ($b = self.$members()).$map, $a._p = (TMP_13 = function(name){var self = TMP_13._s || this;
if (name == null) name = nil;
      return self['$[]'](name)}, TMP_13._s = self, TMP_13), $a).call($b);
    };

    $opal.defn(self, '$values', def.$to_a);

    def.$inspect = function() {
      var $a, $b, TMP_14, self = this, result = nil;

      result = "#<struct ";
      if (self.$class()['$==']((($a = $scope.Struct) == null ? $opal.cm('Struct') : $a))) {
        result = result['$+']("" + (self.$class().$name()) + " ")};
      result = result['$+'](($a = ($b = self.$each_pair()).$map, $a._p = (TMP_14 = function(name, value){var self = TMP_14._s || this;
if (name == null) name = nil;if (value == null) value = nil;
      return "" + (name) + "=" + (value.$inspect())}, TMP_14._s = self, TMP_14), $a).call($b).$join(", "));
      result = result['$+'](">");
      return result;
    };

    return $opal.defn(self, '$to_s', def.$inspect);
  })(self, null)
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/struct.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var $a, $b, self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass, $module = $opal.module, $gvars = $opal.gvars;
  if ($gvars.stdout == null) $gvars.stdout = nil;
  if ($gvars.stderr == null) $gvars.stderr = nil;

  $opal.add_stubs(['$write', '$join', '$map', '$String', '$getbyte', '$getc', '$raise', '$new', '$to_s', '$extend']);
  (function($base, $super) {
    function $IO(){};
    var self = $IO = $klass($base, $super, 'IO', $IO);

    var def = self._proto, $scope = self._scope;

    $opal.cdecl($scope, 'SEEK_SET', 0);

    $opal.cdecl($scope, 'SEEK_CUR', 1);

    $opal.cdecl($scope, 'SEEK_END', 2);

    (function($base) {
      var self = $module($base, 'Writable');

      var def = self._proto, $scope = self._scope;

      def['$<<'] = function(string) {
        var self = this;

        self.$write(string);
        return self;
      };

      def.$print = function(args) {
        var $a, $b, TMP_1, self = this;
        if ($gvars[","] == null) $gvars[","] = nil;

        args = $slice.call(arguments, 0);
        return self.$write(($a = ($b = args).$map, $a._p = (TMP_1 = function(arg){var self = TMP_1._s || this;
if (arg == null) arg = nil;
        return self.$String(arg)}, TMP_1._s = self, TMP_1), $a).call($b).$join($gvars[","]));
      };

      def.$puts = function(args) {
        var $a, $b, TMP_2, self = this;
        if ($gvars["/"] == null) $gvars["/"] = nil;

        args = $slice.call(arguments, 0);
        return self.$write(($a = ($b = args).$map, $a._p = (TMP_2 = function(arg){var self = TMP_2._s || this;
if (arg == null) arg = nil;
        return self.$String(arg)}, TMP_2._s = self, TMP_2), $a).call($b).$join($gvars["/"]));
      };
            ;$opal.donate(self, ["$<<", "$print", "$puts"]);
    })(self);

    return (function($base) {
      var self = $module($base, 'Readable');

      var def = self._proto, $scope = self._scope;

      def.$readbyte = function() {
        var self = this;

        return self.$getbyte();
      };

      def.$readchar = function() {
        var self = this;

        return self.$getc();
      };

      def.$readline = function(sep) {
        var $a, self = this;
        if ($gvars["/"] == null) $gvars["/"] = nil;

        if (sep == null) {
          sep = $gvars["/"]
        }
        return self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
      };

      def.$readpartial = function(integer, outbuf) {
        var $a, self = this;

        if (outbuf == null) {
          outbuf = nil
        }
        return self.$raise((($a = $scope.NotImplementedError) == null ? $opal.cm('NotImplementedError') : $a));
      };
            ;$opal.donate(self, ["$readbyte", "$readchar", "$readline", "$readpartial"]);
    })(self);
  })(self, null);
  $opal.cdecl($scope, 'STDERR', $gvars.stderr = (($a = $scope.IO) == null ? $opal.cm('IO') : $a).$new());
  $opal.cdecl($scope, 'STDIN', $gvars.stdin = (($a = $scope.IO) == null ? $opal.cm('IO') : $a).$new());
  $opal.cdecl($scope, 'STDOUT', $gvars.stdout = (($a = $scope.IO) == null ? $opal.cm('IO') : $a).$new());
  $opal.defs($gvars.stdout, '$write', function(string) {
    var self = this;

    console.log(string.$to_s());;
    return nil;
  });
  $opal.defs($gvars.stderr, '$write', function(string) {
    var self = this;

    console.warn(string.$to_s());;
    return nil;
  });
  $gvars.stdout.$extend((($a = ((($b = $scope.IO) == null ? $opal.cm('IO') : $b))._scope).Writable == null ? $a.cm('Writable') : $a.Writable));
  return $gvars.stderr.$extend((($a = ((($b = $scope.IO) == null ? $opal.cm('IO') : $b))._scope).Writable == null ? $a.cm('Writable') : $a.Writable));
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/io.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice;

  $opal.add_stubs(['$include']);
  $opal.defs(self, '$to_s', function() {
    var self = this;

    return "main";
  });
  return ($opal.defs(self, '$include', function(mod) {
    var $a, self = this;

    return (($a = $scope.Object) == null ? $opal.cm('Object') : $a).$include(mod);
  }), nil) && 'include';
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/main.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var $a, self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $gvars = $opal.gvars, $hash2 = $opal.hash2;

  $opal.add_stubs(['$new']);
  $gvars["&"] = $gvars["~"] = $gvars["`"] = $gvars["'"] = nil;
  $gvars[":"] = [];
  $gvars["\""] = [];
  $gvars["/"] = "\n";
  $gvars[","] = nil;
  $opal.cdecl($scope, 'ARGV', []);
  $opal.cdecl($scope, 'ARGF', (($a = $scope.Object) == null ? $opal.cm('Object') : $a).$new());
  $opal.cdecl($scope, 'ENV', $hash2([], {}));
  $gvars.VERBOSE = false;
  $gvars.DEBUG = false;
  $gvars.SAFE = 0;
  $opal.cdecl($scope, 'RUBY_PLATFORM', "opal");
  $opal.cdecl($scope, 'RUBY_ENGINE', "opal");
  $opal.cdecl($scope, 'RUBY_VERSION', "2.1.1");
  $opal.cdecl($scope, 'RUBY_ENGINE_VERSION', "0.6.1");
  return $opal.cdecl($scope, 'RUBY_RELEASE_DATE', "2014-04-15");
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/corelib/variables.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice;

  $opal.add_stubs([]);
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  return true;
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/opal.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var $a, self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $module = $opal.module, $range = $opal.range, $hash2 = $opal.hash2, $klass = $opal.klass, $gvars = $opal.gvars;

  $opal.add_stubs(['$try_convert', '$native?', '$respond_to?', '$to_n', '$raise', '$inspect', '$Native', '$end_with?', '$define_method', '$[]', '$convert', '$call', '$to_proc', '$new', '$each', '$native_reader', '$native_writer', '$extend', '$to_a', '$to_ary', '$include', '$method_missing', '$bind', '$instance_method', '$[]=', '$slice', '$-', '$length', '$enum_for', '$===', '$>=', '$<<', '$==', '$instance_variable_set', '$members', '$each_with_index', '$each_pair', '$name']);
  (function($base) {
    var self = $module($base, 'Native');

    var def = self._proto, $scope = self._scope, TMP_1;

    $opal.defs(self, '$is_a?', function(object, klass) {
      var self = this;

      
      try {
        return object instanceof self.$try_convert(klass);
      }
      catch (e) {
        return false;
      }
    ;
    });

    $opal.defs(self, '$try_convert', function(value) {
      var self = this;

      
      if (self['$native?'](value)) {
        return value;
      }
      else if (value['$respond_to?']("to_n")) {
        return value.$to_n();
      }
      else {
        return nil;
      }
    ;
    });

    $opal.defs(self, '$convert', function(value) {
      var $a, self = this;

      
      if (self['$native?'](value)) {
        return value;
      }
      else if (value['$respond_to?']("to_n")) {
        return value.$to_n();
      }
      else {
        self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "" + (value.$inspect()) + " isn't native");
      }
    ;
    });

    $opal.defs(self, '$call', TMP_1 = function(obj, key, args) {
      var self = this, $iter = TMP_1._p, block = $iter || nil;

      args = $slice.call(arguments, 2);
      TMP_1._p = null;
      
      var prop = obj[key];

      if (prop instanceof Function) {
        var converted = new Array(args.length);

        for (var i = 0, length = args.length; i < length; i++) {
          var item = args[i],
              conv = self.$try_convert(item);

          converted[i] = conv === nil ? item : conv;
        }

        if (block !== nil) {
          converted.push(block);
        }

        return self.$Native(prop.apply(obj, converted));
      }
      else {
        return self.$Native(prop);
      }
    ;
    });

    (function($base) {
      var self = $module($base, 'Helpers');

      var def = self._proto, $scope = self._scope;

      def.$alias_native = function(new$, old, options) {
        var $a, $b, TMP_2, $c, TMP_3, $d, TMP_4, self = this, as = nil;

        if (old == null) {
          old = new$
        }
        if (options == null) {
          options = $hash2([], {})
        }
        if ((($a = old['$end_with?']("=")) !== nil && (!$a._isBoolean || $a == true))) {
          return ($a = ($b = self).$define_method, $a._p = (TMP_2 = function(value){var self = TMP_2._s || this, $a;
            if (self["native"] == null) self["native"] = nil;
if (value == null) value = nil;
          self["native"][old['$[]']($range(0, -2, false))] = (($a = $scope.Native) == null ? $opal.cm('Native') : $a).$convert(value);
            return value;}, TMP_2._s = self, TMP_2), $a).call($b, new$)
        } else if ((($a = as = options['$[]']("as")) !== nil && (!$a._isBoolean || $a == true))) {
          return ($a = ($c = self).$define_method, $a._p = (TMP_3 = function(args){var self = TMP_3._s || this, block, $a, $b, $c, $d;
            if (self["native"] == null) self["native"] = nil;
args = $slice.call(arguments, 0);
            block = TMP_3._p || nil, TMP_3._p = null;
          if ((($a = value = ($b = ($c = (($d = $scope.Native) == null ? $opal.cm('Native') : $d)).$call, $b._p = block.$to_proc(), $b).apply($c, [self["native"], old].concat(args))) !== nil && (!$a._isBoolean || $a == true))) {
              return as.$new(value.$to_n())
              } else {
              return nil
            }}, TMP_3._s = self, TMP_3), $a).call($c, new$)
          } else {
          return ($a = ($d = self).$define_method, $a._p = (TMP_4 = function(args){var self = TMP_4._s || this, block, $a, $b, $c;
            if (self["native"] == null) self["native"] = nil;
args = $slice.call(arguments, 0);
            block = TMP_4._p || nil, TMP_4._p = null;
          return ($a = ($b = (($c = $scope.Native) == null ? $opal.cm('Native') : $c)).$call, $a._p = block.$to_proc(), $a).apply($b, [self["native"], old].concat(args))}, TMP_4._s = self, TMP_4), $a).call($d, new$)
        };
      };

      def.$native_reader = function(names) {
        var $a, $b, TMP_5, self = this;

        names = $slice.call(arguments, 0);
        return ($a = ($b = names).$each, $a._p = (TMP_5 = function(name){var self = TMP_5._s || this, $a, $b, TMP_6;
if (name == null) name = nil;
        return ($a = ($b = self).$define_method, $a._p = (TMP_6 = function(){var self = TMP_6._s || this;
            if (self["native"] == null) self["native"] = nil;

          return self.$Native(self["native"][name])}, TMP_6._s = self, TMP_6), $a).call($b, name)}, TMP_5._s = self, TMP_5), $a).call($b);
      };

      def.$native_writer = function(names) {
        var $a, $b, TMP_7, self = this;

        names = $slice.call(arguments, 0);
        return ($a = ($b = names).$each, $a._p = (TMP_7 = function(name){var self = TMP_7._s || this, $a, $b, TMP_8;
if (name == null) name = nil;
        return ($a = ($b = self).$define_method, $a._p = (TMP_8 = function(value){var self = TMP_8._s || this;
            if (self["native"] == null) self["native"] = nil;
if (value == null) value = nil;
          return self.$Native(self["native"][name] = value)}, TMP_8._s = self, TMP_8), $a).call($b, "" + (name) + "=")}, TMP_7._s = self, TMP_7), $a).call($b);
      };

      def.$native_accessor = function(names) {
        var $a, $b, self = this;

        names = $slice.call(arguments, 0);
        ($a = self).$native_reader.apply($a, [].concat(names));
        return ($b = self).$native_writer.apply($b, [].concat(names));
      };
            ;$opal.donate(self, ["$alias_native", "$native_reader", "$native_writer", "$native_accessor"]);
    })(self);

    $opal.defs(self, '$included', function(klass) {
      var $a, self = this;

      return klass.$extend((($a = $scope.Helpers) == null ? $opal.cm('Helpers') : $a));
    });

    def.$initialize = function(native$) {
      var $a, $b, self = this;

      if ((($a = (($b = $scope.Kernel) == null ? $opal.cm('Kernel') : $b)['$native?'](native$)) !== nil && (!$a._isBoolean || $a == true))) {
        } else {
        (($a = $scope.Kernel) == null ? $opal.cm('Kernel') : $a).$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "" + (native$.$inspect()) + " isn't native")
      };
      return self["native"] = native$;
    };

    def.$to_n = function() {
      var self = this;
      if (self["native"] == null) self["native"] = nil;

      return self["native"];
    };
        ;$opal.donate(self, ["$initialize", "$to_n"]);
  })(self);
  (function($base) {
    var self = $module($base, 'Kernel');

    var def = self._proto, $scope = self._scope, TMP_9;

    def['$native?'] = function(value) {
      var self = this;

      return value == null || !value._klass;
    };

    def.$Native = function(obj) {
      var $a, $b, self = this;

      if ((($a = obj == null) !== nil && (!$a._isBoolean || $a == true))) {
        return nil
      } else if ((($a = self['$native?'](obj)) !== nil && (!$a._isBoolean || $a == true))) {
        return (($a = ((($b = $scope.Native) == null ? $opal.cm('Native') : $b))._scope).Object == null ? $a.cm('Object') : $a.Object).$new(obj)
        } else {
        return obj
      };
    };

    def.$Array = TMP_9 = function(object, args) {
      var $a, $b, $c, $d, self = this, $iter = TMP_9._p, block = $iter || nil;

      args = $slice.call(arguments, 1);
      TMP_9._p = null;
      
      if (object == null || object === nil) {
        return [];
      }
      else if (self['$native?'](object)) {
        return ($a = ($b = (($c = ((($d = $scope.Native) == null ? $opal.cm('Native') : $d))._scope).Array == null ? $c.cm('Array') : $c.Array)).$new, $a._p = block.$to_proc(), $a).apply($b, [object].concat(args)).$to_a();
      }
      else if (object['$respond_to?']("to_ary")) {
        return object.$to_ary();
      }
      else if (object['$respond_to?']("to_a")) {
        return object.$to_a();
      }
      else {
        return [object];
      }
    ;
    };
        ;$opal.donate(self, ["$native?", "$Native", "$Array"]);
  })(self);
  (function($base, $super) {
    function $Object(){};
    var self = $Object = $klass($base, $super, 'Object', $Object);

    var def = self._proto, $scope = self._scope, $a, TMP_10, TMP_11, TMP_12;

    def["native"] = nil;
    self.$include((($a = $scope.Native) == null ? $opal.cm('Native') : $a));

    $opal.defn(self, '$==', function(other) {
      var $a, self = this;

      return self["native"] === (($a = $scope.Native) == null ? $opal.cm('Native') : $a).$try_convert(other);
    });

    $opal.defn(self, '$has_key?', function(name) {
      var self = this;

      return $opal.hasOwnProperty.call(self["native"], name);
    });

    $opal.defn(self, '$key?', def['$has_key?']);

    $opal.defn(self, '$include?', def['$has_key?']);

    $opal.defn(self, '$member?', def['$has_key?']);

    $opal.defn(self, '$each', TMP_10 = function(args) {
      var $a, self = this, $iter = TMP_10._p, $yield = $iter || nil;

      args = $slice.call(arguments, 0);
      TMP_10._p = null;
      if (($yield !== nil)) {
        
        for (var key in self["native"]) {
          ((($a = $opal.$yieldX($yield, [key, self["native"][key]])) === $breaker) ? $breaker.$v : $a)
        }
      ;
        return self;
        } else {
        return ($a = self).$method_missing.apply($a, ["each"].concat(args))
      };
    });

    $opal.defn(self, '$[]', function(key) {
      var $a, self = this;

      
      var prop = self["native"][key];

      if (prop instanceof Function) {
        return prop;
      }
      else {
        return (($a = $opal.Object._scope.Native) == null ? $opal.cm('Native') : $a).$call(self["native"], key)
      }
    ;
    });

    $opal.defn(self, '$[]=', function(key, value) {
      var $a, self = this, native$ = nil;

      native$ = (($a = $scope.Native) == null ? $opal.cm('Native') : $a).$try_convert(value);
      if ((($a = native$ === nil) !== nil && (!$a._isBoolean || $a == true))) {
        return self["native"][key] = value;
        } else {
        return self["native"][key] = native$;
      };
    });

    $opal.defn(self, '$merge!', function(other) {
      var $a, self = this;

      
      var other = (($a = $scope.Native) == null ? $opal.cm('Native') : $a).$convert(other);

      for (var prop in other) {
        self["native"][prop] = other[prop];
      }
    ;
      return self;
    });

    $opal.defn(self, '$respond_to?', function(name, include_all) {
      var $a, self = this;

      if (include_all == null) {
        include_all = false
      }
      return (($a = $scope.Kernel) == null ? $opal.cm('Kernel') : $a).$instance_method("respond_to?").$bind(self).$call(name, include_all);
    });

    $opal.defn(self, '$respond_to_missing?', function(name) {
      var self = this;

      return $opal.hasOwnProperty.call(self["native"], name);
    });

    $opal.defn(self, '$method_missing', TMP_11 = function(mid, args) {
      var $a, $b, $c, self = this, $iter = TMP_11._p, block = $iter || nil;

      args = $slice.call(arguments, 1);
      TMP_11._p = null;
      
      if (mid.charAt(mid.length - 1) === '=') {
        return self['$[]='](mid.$slice(0, mid.$length()['$-'](1)), args['$[]'](0));
      }
      else {
        return ($a = ($b = (($c = $opal.Object._scope.Native) == null ? $opal.cm('Native') : $c)).$call, $a._p = block.$to_proc(), $a).apply($b, [self["native"], mid].concat(args));
      }
    ;
    });

    $opal.defn(self, '$nil?', function() {
      var self = this;

      return false;
    });

    $opal.defn(self, '$is_a?', function(klass) {
      var self = this;

      return $opal.is_a(self, klass);
    });

    $opal.defn(self, '$kind_of?', def['$is_a?']);

    $opal.defn(self, '$instance_of?', function(klass) {
      var self = this;

      return self._klass === klass;
    });

    $opal.defn(self, '$class', function() {
      var self = this;

      return self._klass;
    });

    $opal.defn(self, '$to_a', TMP_12 = function(options) {
      var $a, $b, $c, $d, self = this, $iter = TMP_12._p, block = $iter || nil;

      if (options == null) {
        options = $hash2([], {})
      }
      TMP_12._p = null;
      return ($a = ($b = (($c = ((($d = $scope.Native) == null ? $opal.cm('Native') : $d))._scope).Array == null ? $c.cm('Array') : $c.Array)).$new, $a._p = block.$to_proc(), $a).call($b, self["native"], options).$to_a();
    });

    return ($opal.defn(self, '$inspect', function() {
      var self = this;

      return "#<Native:" + (String(self["native"])) + ">";
    }), nil) && 'inspect';
  })((($a = $scope.Native) == null ? $opal.cm('Native') : $a), (($a = $scope.BasicObject) == null ? $opal.cm('BasicObject') : $a));
  (function($base, $super) {
    function $Array(){};
    var self = $Array = $klass($base, $super, 'Array', $Array);

    var def = self._proto, $scope = self._scope, $a, TMP_13, TMP_14;

    def.named = def["native"] = def.get = def.block = def.set = def.length = nil;
    self.$include((($a = $scope.Native) == null ? $opal.cm('Native') : $a));

    self.$include((($a = $scope.Enumerable) == null ? $opal.cm('Enumerable') : $a));

    def.$initialize = TMP_13 = function(native$, options) {
      var $a, self = this, $iter = TMP_13._p, block = $iter || nil;

      if (options == null) {
        options = $hash2([], {})
      }
      TMP_13._p = null;
      $opal.find_super_dispatcher(self, 'initialize', TMP_13, null).apply(self, [native$]);
      self.get = ((($a = options['$[]']("get")) !== false && $a !== nil) ? $a : options['$[]']("access"));
      self.named = options['$[]']("named");
      self.set = ((($a = options['$[]']("set")) !== false && $a !== nil) ? $a : options['$[]']("access"));
      self.length = ((($a = options['$[]']("length")) !== false && $a !== nil) ? $a : "length");
      self.block = block;
      if ((($a = self.$length() == null) !== nil && (!$a._isBoolean || $a == true))) {
        return self.$raise((($a = $scope.ArgumentError) == null ? $opal.cm('ArgumentError') : $a), "no length found on the array-like object")
        } else {
        return nil
      };
    };

    def.$each = TMP_14 = function() {
      var self = this, $iter = TMP_14._p, block = $iter || nil;

      TMP_14._p = null;
      if (block !== false && block !== nil) {
        } else {
        return self.$enum_for("each")
      };
      
      for (var i = 0, length = self.$length(); i < length; i++) {
        var value = $opal.$yield1(block, self['$[]'](i));

        if (value === $breaker) {
          return $breaker.$v;
        }
      }
    ;
      return self;
    };

    def['$[]'] = function(index) {
      var $a, self = this, result = nil, $case = nil;

      result = (function() {$case = index;if ((($a = $scope.String) == null ? $opal.cm('String') : $a)['$===']($case) || (($a = $scope.Symbol) == null ? $opal.cm('Symbol') : $a)['$===']($case)) {if ((($a = self.named) !== nil && (!$a._isBoolean || $a == true))) {
        return self["native"][self.named](index);
        } else {
        return self["native"][index];
      }}else if ((($a = $scope.Integer) == null ? $opal.cm('Integer') : $a)['$===']($case)) {if ((($a = self.get) !== nil && (!$a._isBoolean || $a == true))) {
        return self["native"][self.get](index);
        } else {
        return self["native"][index];
      }}else { return nil }})();
      if (result !== false && result !== nil) {
        if ((($a = self.block) !== nil && (!$a._isBoolean || $a == true))) {
          return self.block.$call(result)
          } else {
          return self.$Native(result)
        }
        } else {
        return nil
      };
    };

    def['$[]='] = function(index, value) {
      var $a, self = this;

      if ((($a = self.set) !== nil && (!$a._isBoolean || $a == true))) {
        return self["native"][self.set](index, (($a = $scope.Native) == null ? $opal.cm('Native') : $a).$convert(value));
        } else {
        return self["native"][index] = (($a = $scope.Native) == null ? $opal.cm('Native') : $a).$convert(value);
      };
    };

    def.$last = function(count) {
      var $a, self = this, index = nil, result = nil;

      if (count == null) {
        count = nil
      }
      if (count !== false && count !== nil) {
        index = self.$length()['$-'](1);
        result = [];
        while (index['$>='](0)) {
        result['$<<'](self['$[]'](index));
        index = index['$-'](1);};
        return result;
        } else {
        return self['$[]'](self.$length()['$-'](1))
      };
    };

    def.$length = function() {
      var self = this;

      return self["native"][self.length];
    };

    $opal.defn(self, '$to_ary', def.$to_a);

    return (def.$inspect = function() {
      var self = this;

      return self.$to_a().$inspect();
    }, nil) && 'inspect';
  })((($a = $scope.Native) == null ? $opal.cm('Native') : $a), null);
  (function($base, $super) {
    function $Numeric(){};
    var self = $Numeric = $klass($base, $super, 'Numeric', $Numeric);

    var def = self._proto, $scope = self._scope;

    return (def.$to_n = function() {
      var self = this;

      return self.valueOf();
    }, nil) && 'to_n'
  })(self, null);
  (function($base, $super) {
    function $Proc(){};
    var self = $Proc = $klass($base, $super, 'Proc', $Proc);

    var def = self._proto, $scope = self._scope;

    return (def.$to_n = function() {
      var self = this;

      return self;
    }, nil) && 'to_n'
  })(self, null);
  (function($base, $super) {
    function $String(){};
    var self = $String = $klass($base, $super, 'String', $String);

    var def = self._proto, $scope = self._scope;

    return (def.$to_n = function() {
      var self = this;

      return self.valueOf();
    }, nil) && 'to_n'
  })(self, null);
  (function($base, $super) {
    function $Regexp(){};
    var self = $Regexp = $klass($base, $super, 'Regexp', $Regexp);

    var def = self._proto, $scope = self._scope;

    return (def.$to_n = function() {
      var self = this;

      return self.valueOf();
    }, nil) && 'to_n'
  })(self, null);
  (function($base, $super) {
    function $MatchData(){};
    var self = $MatchData = $klass($base, $super, 'MatchData', $MatchData);

    var def = self._proto, $scope = self._scope;

    def.matches = nil;
    return (def.$to_n = function() {
      var self = this;

      return self.matches;
    }, nil) && 'to_n'
  })(self, null);
  (function($base, $super) {
    function $Struct(){};
    var self = $Struct = $klass($base, $super, 'Struct', $Struct);

    var def = self._proto, $scope = self._scope;

    def.$initialize = function(args) {
      var $a, $b, TMP_15, $c, TMP_16, self = this, object = nil;

      args = $slice.call(arguments, 0);
      if ((($a = (($b = args.$length()['$=='](1)) ? self['$native?'](args['$[]'](0)) : $b)) !== nil && (!$a._isBoolean || $a == true))) {
        object = args['$[]'](0);
        return ($a = ($b = self.$members()).$each, $a._p = (TMP_15 = function(name){var self = TMP_15._s || this;
if (name == null) name = nil;
        return self.$instance_variable_set("@" + (name), self.$Native(object[name]))}, TMP_15._s = self, TMP_15), $a).call($b);
        } else {
        return ($a = ($c = self.$members()).$each_with_index, $a._p = (TMP_16 = function(name, index){var self = TMP_16._s || this;
if (name == null) name = nil;if (index == null) index = nil;
        return self.$instance_variable_set("@" + (name), args['$[]'](index))}, TMP_16._s = self, TMP_16), $a).call($c)
      };
    };

    return (def.$to_n = function() {
      var $a, $b, TMP_17, self = this, result = nil;

      result = {};
      ($a = ($b = self).$each_pair, $a._p = (TMP_17 = function(name, value){var self = TMP_17._s || this;
if (name == null) name = nil;if (value == null) value = nil;
      return result[name] = value.$to_n();}, TMP_17._s = self, TMP_17), $a).call($b);
      return result;
    }, nil) && 'to_n';
  })(self, null);
  (function($base, $super) {
    function $Array(){};
    var self = $Array = $klass($base, $super, 'Array', $Array);

    var def = self._proto, $scope = self._scope;

    return (def.$to_n = function() {
      var self = this;

      
      var result = [];

      for (var i = 0, length = self.length; i < length; i++) {
        var obj = self[i];

        if ((obj)['$respond_to?']("to_n")) {
          result.push((obj).$to_n());
        }
        else {
          result.push(obj);
        }
      }

      return result;
    ;
    }, nil) && 'to_n'
  })(self, null);
  (function($base, $super) {
    function $Boolean(){};
    var self = $Boolean = $klass($base, $super, 'Boolean', $Boolean);

    var def = self._proto, $scope = self._scope;

    return (def.$to_n = function() {
      var self = this;

      return self.valueOf();
    }, nil) && 'to_n'
  })(self, null);
  (function($base, $super) {
    function $Time(){};
    var self = $Time = $klass($base, $super, 'Time', $Time);

    var def = self._proto, $scope = self._scope;

    return (def.$to_n = function() {
      var self = this;

      return self;
    }, nil) && 'to_n'
  })(self, null);
  (function($base, $super) {
    function $NilClass(){};
    var self = $NilClass = $klass($base, $super, 'NilClass', $NilClass);

    var def = self._proto, $scope = self._scope;

    return (def.$to_n = function() {
      var self = this;

      return null;
    }, nil) && 'to_n'
  })(self, null);
  (function($base, $super) {
    function $Hash(){};
    var self = $Hash = $klass($base, $super, 'Hash', $Hash);

    var def = self._proto, $scope = self._scope, TMP_18;

    def.$initialize = TMP_18 = function(defaults) {
      var $a, self = this, $iter = TMP_18._p, block = $iter || nil;

      TMP_18._p = null;
      
      if (defaults != null) {
        if (defaults.constructor === Object) {
          var map  = self.map,
              keys = self.keys;

          for (var key in defaults) {
            var value = defaults[key];

            if (value && value.constructor === Object) {
              map[key] = (($a = $scope.Hash) == null ? $opal.cm('Hash') : $a).$new(value);
            }
            else {
              map[key] = self.$Native(defaults[key]);
            }

            keys.push(key);
          }
        }
        else {
          self.none = defaults;
        }
      }
      else if (block !== nil) {
        self.proc = block;
      }

      return self;
    
    };

    return (def.$to_n = function() {
      var self = this;

      
      var result = {},
          keys   = self.keys,
          map    = self.map,
          bucket,
          value;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i],
            obj = map[key];

        if ((obj)['$respond_to?']("to_n")) {
          result[key] = (obj).$to_n();
        }
        else {
          result[key] = obj;
        }
      }

      return result;
    ;
    }, nil) && 'to_n';
  })(self, null);
  (function($base, $super) {
    function $Module(){};
    var self = $Module = $klass($base, $super, 'Module', $Module);

    var def = self._proto, $scope = self._scope;

    return (def.$native_module = function() {
      var self = this;

      return Opal.global[self.$name()] = self;
    }, nil) && 'native_module'
  })(self, null);
  (function($base, $super) {
    function $Class(){};
    var self = $Class = $klass($base, $super, 'Class', $Class);

    var def = self._proto, $scope = self._scope;

    def.$native_alias = function(jsid, mid) {
      var self = this;

      return self._proto[jsid] = self._proto['$' + mid];
    };

    return $opal.defn(self, '$native_class', def.$native_module);
  })(self, null);
  return $gvars.$ = $gvars.global = self.$Native(Opal.global);
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/native.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;

  $opal.add_stubs(['$include', '$attr_reader', '$expose', '$alias_native', '$[]=', '$nil?', '$is_a?', '$to_n', '$has_key?', '$delete', '$call', '$gsub', '$upcase', '$[]', '$compact', '$map', '$respond_to?', '$<<', '$Native', '$new']);
  ;
  
  var root = $opal.global, dom_class;

  if (root.jQuery) {
    dom_class = jQuery
  }
  else if (root.Zepto) {
    dom_class = Zepto.zepto.Z;
  }
  else {
    throw new Error("jQuery must be included before opal-jquery");
  }

  return (function($base, $super) {
    function $Element(){};
    var self = $Element = $klass($base, $super, 'Element', $Element);

    var def = self._proto, $scope = self._scope, $a, TMP_1, TMP_2, TMP_5, TMP_6;

    self.$include((($a = $scope.Enumerable) == null ? $opal.cm('Enumerable') : $a));

    $opal.defs(self, '$find', function(selector) {
      var self = this;

      return $(selector);
    });

    $opal.defs(self, '$[]', function(selector) {
      var self = this;

      return $(selector);
    });

    $opal.defs(self, '$id', function(id) {
      var self = this;

      
      var el = document.getElementById(id);

      if (!el) {
        return nil;
      }

      return $(el);
    
    });

    $opal.defs(self, '$new', function(tag) {
      var self = this;

      if (tag == null) {
        tag = "div"
      }
      return $(document.createElement(tag));
    });

    $opal.defs(self, '$parse', function(str) {
      var self = this;

      return $(str);
    });

    $opal.defs(self, '$expose', function(methods) {
      var self = this;

      methods = $slice.call(arguments, 0);
      
      for (var i = 0, length = methods.length, method; i < length; i++) {
        method = methods[i];
        self._proto['$' + method] = self._proto[method];
      }

      return nil;
    
    });

    self.$attr_reader("selector");

    self.$expose("after", "before", "parent", "parents", "prepend", "prev", "remove");

    self.$expose("hide", "show", "toggle", "children", "blur", "closest", "detach");

    self.$expose("focus", "find", "next", "siblings", "text", "trigger", "append");

    self.$expose("height", "width", "serialize", "is", "filter", "last", "first");

    self.$expose("wrap", "stop", "clone", "empty");

    self.$expose("get", "attr", "prop");

    $opal.defn(self, '$succ', def.$next);

    $opal.defn(self, '$<<', def.$append);

    self.$alias_native("[]=", "attr");

    self.$alias_native("add_class", "addClass");

    self.$alias_native("append_to", "appendTo");

    self.$alias_native("has_class?", "hasClass");

    self.$alias_native("html=", "html");

    self.$alias_native("remove_attr", "removeAttr");

    self.$alias_native("remove_class", "removeClass");

    self.$alias_native("text=", "text");

    self.$alias_native("toggle_class", "toggleClass");

    self.$alias_native("value=", "val");

    self.$alias_native("scroll_left=", "scrollLeft");

    self.$alias_native("scroll_left", "scrollLeft");

    self.$alias_native("remove_attribute", "removeAttr");

    self.$alias_native("slide_down", "slideDown");

    self.$alias_native("slide_up", "slideUp");

    self.$alias_native("slide_toggle", "slideToggle");

    self.$alias_native("fade_toggle", "fadeToggle");

    def.$to_n = function() {
      var self = this;

      return self;
    };

    def['$[]'] = function(name) {
      var self = this;

      return self.attr(name) || "";
    };

    def.$add_attribute = function(name) {
      var self = this;

      return self['$[]='](name, "");
    };

    def['$has_attribute?'] = function(name) {
      var self = this;

      return !!self.attr(name);
    };

    def.$append_to_body = function() {
      var self = this;

      return self.appendTo(document.body);
    };

    def.$append_to_head = function() {
      var self = this;

      return self.appendTo(document.head);
    };

    def.$at = function(index) {
      var self = this;

      
      var length = self.length;

      if (index < 0) {
        index += length;
      }

      if (index < 0 || index >= length) {
        return nil;
      }

      return $(self[index]);
    
    };

    def.$class_name = function() {
      var self = this;

      
      var first = self[0];
      return (first && first.className) || "";
    
    };

    def['$class_name='] = function(name) {
      var self = this;

      
      for (var i = 0, length = self.length; i < length; i++) {
        self[i].className = name;
      }
    
      return self;
    };

    def.$css = function(name, value) {
      var $a, $b, $c, self = this;

      if (value == null) {
        value = nil
      }
      if ((($a = ($b = value['$nil?'](), $b !== false && $b !== nil ?name['$is_a?']((($c = $scope.String) == null ? $opal.cm('String') : $c)) : $b)) !== nil && (!$a._isBoolean || $a == true))) {
        return self.css(name)
      } else if ((($a = name['$is_a?']((($b = $scope.Hash) == null ? $opal.cm('Hash') : $b))) !== nil && (!$a._isBoolean || $a == true))) {
        self.css(name.$to_n());
        } else {
        self.css(name, value);
      };
      return self;
    };

    def.$animate = TMP_1 = function(params) {
      var $a, self = this, $iter = TMP_1._p, block = $iter || nil, speed = nil;

      TMP_1._p = null;
      speed = (function() {if ((($a = params['$has_key?']("speed")) !== nil && (!$a._isBoolean || $a == true))) {
        return params.$delete("speed")
        } else {
        return 400
      }; return nil; })();
      
      self.animate(params.$to_n(), speed, function() {
        (function() {if ((block !== nil)) {
        return block.$call()
        } else {
        return nil
      }; return nil; })()
      })
    ;
    };

    def.$data = function(args) {
      var self = this;

      args = $slice.call(arguments, 0);
      
      var result = self.data.apply(self, args);
      return result == null ? nil : result;
    
    };

    def.$effect = TMP_2 = function(name, args) {
      var $a, $b, TMP_3, $c, TMP_4, self = this, $iter = TMP_2._p, block = $iter || nil;

      args = $slice.call(arguments, 1);
      TMP_2._p = null;
      name = ($a = ($b = name).$gsub, $a._p = (TMP_3 = function(match){var self = TMP_3._s || this;
if (match == null) match = nil;
      return match['$[]'](1).$upcase()}, TMP_3._s = self, TMP_3), $a).call($b, /_\w/);
      args = ($a = ($c = args).$map, $a._p = (TMP_4 = function(a){var self = TMP_4._s || this, $a;
if (a == null) a = nil;
      if ((($a = a['$respond_to?']("to_n")) !== nil && (!$a._isBoolean || $a == true))) {
          return a.$to_n()
          } else {
          return nil
        }}, TMP_4._s = self, TMP_4), $a).call($c).$compact();
      args['$<<'](function() { (function() {if ((block !== nil)) {
        return block.$call()
        } else {
        return nil
      }; return nil; })() });
      return self[name].apply(self, args);
    };

    def['$visible?'] = function() {
      var self = this;

      return self.is(':visible');
    };

    def.$offset = function() {
      var self = this;

      return self.$Native(self.offset());
    };

    def.$each = TMP_5 = function() {
      var self = this, $iter = TMP_5._p, $yield = $iter || nil;

      TMP_5._p = null;
      for (var i = 0, length = self.length; i < length; i++) {
      if ($opal.$yield1($yield, $(self[i])) === $breaker) return $breaker.$v;
      };
      return self;
    };

    def.$first = function() {
      var self = this;

      return self.length ? self.first() : nil;
    };

    def.$html = function(content) {
      var self = this;

      
      if (content != null) {
        return self.html(content);
      }

      return self.html() || '';
    
    };

    def.$id = function() {
      var self = this;

      
      var first = self[0];
      return (first && first.id) || "";
    
    };

    def['$id='] = function(id) {
      var self = this;

      
      var first = self[0];

      if (first) {
        first.id = id;
      }

      return self;
    
    };

    def.$tag_name = function() {
      var self = this;

      return self.length > 0 ? self[0].tagName.toLowerCase() : nil;
    };

    def.$inspect = function() {
      var self = this;

      
      var val, el, str, result = [];

      for (var i = 0, length = self.length; i < length; i++) {
        el  = self[i];
        str = "<" + el.tagName.toLowerCase();

        if (val = el.id) str += (' id="' + val + '"');
        if (val = el.className) str += (' class="' + val + '"');

        result.push(str + '>');
      }

      return '#<Element [' + result.join(', ') + ']>';
    
    };

    def.$length = function() {
      var self = this;

      return self.length;
    };

    def['$any?'] = function() {
      var self = this;

      return self.length > 0;
    };

    def['$empty?'] = function() {
      var self = this;

      return self.length === 0;
    };

    $opal.defn(self, '$empty?', def['$none?']);

    def.$on = TMP_6 = function(name, sel) {
      var $a, self = this, $iter = TMP_6._p, block = $iter || nil;

      if (sel == null) {
        sel = nil
      }
      TMP_6._p = null;
      
      var wrapper = function(evt) {
        if (evt.preventDefault) {
          evt = (($a = $scope.Event) == null ? $opal.cm('Event') : $a).$new(evt);
        }

        return block.apply(null, arguments);
      };

      block._jq_wrap = wrapper;

      if (sel == nil) {
        self.on(name, wrapper);
      }
      else {
        self.on(name, sel, wrapper);
      }
    ;
      return block;
    };

    def.$off = function(name, sel, block) {
      var self = this;

      if (block == null) {
        block = nil
      }
      
      if (sel == null) {
        return self.off(name);
      }
      else if (block === nil) {
        return self.off(name, sel._jq_wrap);
      }
      else {
        return self.off(name, sel, block._jq_wrap);
      }
    
    };

    $opal.defn(self, '$size', def.$length);

    return (def.$value = function() {
      var self = this;

      return self.val() || "";
    }, nil) && 'value';
  })(self, dom_class);
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/opal-jquery/element.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var $a, self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $gvars = $opal.gvars;

  $opal.add_stubs(['$find']);
  ;
  $opal.cdecl($scope, 'Window', (($a = $scope.Element) == null ? $opal.cm('Element') : $a).$find(window));
  return $gvars.window = (($a = $scope.Window) == null ? $opal.cm('Window') : $a);
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/opal-jquery/window.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var $a, self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $gvars = $opal.gvars;

  $opal.add_stubs(['$find']);
  ;
  $opal.cdecl($scope, 'Document', (($a = $scope.Element) == null ? $opal.cm('Element') : $a).$find(document));
  (function(self) {
    var $scope = self._scope, def = self._proto;

    self._proto['$ready?'] = TMP_1 = function() {
      var self = this, $iter = TMP_1._p, block = $iter || nil;

      TMP_1._p = null;
      if (block !== false && block !== nil) {
        return $(block);
        } else {
        return nil
      };
    };
    self._proto.$title = function() {
      var self = this;

      return document.title;
    };
    self._proto['$title='] = function(title) {
      var self = this;

      return document.title = title;
    };
    self._proto.$head = function() {
      var $a, self = this;

      return (($a = $scope.Element) == null ? $opal.cm('Element') : $a).$find(document.head);
    };
    return (self._proto.$body = function() {
      var $a, self = this;

      return (($a = $scope.Element) == null ? $opal.cm('Element') : $a).$find(document.body);
    }, nil) && 'body';
  })((($a = $scope.Document) == null ? $opal.cm('Document') : $a).$singleton_class());
  return $gvars.document = (($a = $scope.Document) == null ? $opal.cm('Document') : $a);
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/opal-jquery/document.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass;

  $opal.add_stubs(['$stop', '$prevent']);
  return (function($base, $super) {
    function $Event(){};
    var self = $Event = $klass($base, $super, 'Event', $Event);

    var def = self._proto, $scope = self._scope;

    def["native"] = nil;
    def.$initialize = function(native$) {
      var self = this;

      return self["native"] = native$;
    };

    def['$[]'] = function(name) {
      var self = this;

      return self["native"][name];
    };

    def.$type = function() {
      var self = this;

      return self["native"].type;
    };

    def.$current_target = function() {
      var self = this;

      return $(self["native"].currentTarget);
    };

    def.$target = function() {
      var self = this;

      return $(self["native"].target);
    };

    def['$prevented?'] = function() {
      var self = this;

      return self["native"].isDefaultPrevented();
    };

    def.$prevent = function() {
      var self = this;

      return self["native"].preventDefault();
    };

    def['$stopped?'] = function() {
      var self = this;

      return self["native"].propagationStopped();
    };

    def.$stop = function() {
      var self = this;

      return self["native"].stopPropagation();
    };

    def.$stop_immediate = function() {
      var self = this;

      return self["native"].stopImmediatePropagation();
    };

    def.$kill = function() {
      var self = this;

      self.$stop();
      return self.$prevent();
    };

    $opal.defn(self, '$default_prevented?', def['$prevented?']);

    $opal.defn(self, '$prevent_default', def.$prevent);

    $opal.defn(self, '$propagation_stopped?', def['$stopped?']);

    $opal.defn(self, '$stop_propagation', def.$stop);

    $opal.defn(self, '$stop_immediate_propagation', def.$stop_immediate);

    def.$page_x = function() {
      var self = this;

      return self["native"].pageX;
    };

    def.$page_y = function() {
      var self = this;

      return self["native"].pageY;
    };

    def.$touch_x = function() {
      var self = this;

      return self["native"].originalEvent.touches[0].pageX;
    };

    def.$touch_y = function() {
      var self = this;

      return self["native"].originalEvent.touches[0].pageY;
    };

    def.$ctrl_key = function() {
      var self = this;

      return self["native"].ctrlKey;
    };

    def.$key_code = function() {
      var self = this;

      return self["native"].keyCode;
    };

    return (def.$which = function() {
      var self = this;

      return self["native"].which;
    }, nil) && 'which';
  })(self, null)
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/opal-jquery/event.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $module = $opal.module, $hash2 = $opal.hash2, $klass = $opal.klass;

  $opal.add_stubs(['$new', '$push', '$[]=', '$[]', '$create_id', '$json_create', '$attr_accessor', '$create_id=', '$===', '$parse', '$generate', '$from_object', '$to_json', '$responds_to?', '$to_io', '$write', '$to_s', '$strftime']);
  (function($base) {
    var self = $module($base, 'JSON');

    var def = self._proto, $scope = self._scope, $a;

    
    var $parse  = JSON.parse,
        $hasOwn = Opal.hasOwnProperty;

    function to_opal(value, options) {
      switch (typeof value) {
        case 'string':
          return value;

        case 'number':
          return value;

        case 'boolean':
          return !!value;

        case 'null':
          return nil;

        case 'object':
          if (!value) return nil;

          if (value._isArray) {
            var arr = (options.array_class).$new();

            for (var i = 0, ii = value.length; i < ii; i++) {
              (arr).$push(to_opal(value[i], options));
            }

            return arr;
          }
          else {
            var hash = (options.object_class).$new();

            for (var k in value) {
              if ($hasOwn.call(value, k)) {
                (hash)['$[]='](k, to_opal(value[k], options));
              }
            }

            var klass;
            if ((klass = (hash)['$[]']((($a = $scope.JSON) == null ? $opal.cm('JSON') : $a).$create_id())) != nil) {
              klass = Opal.cget(klass);
              return (klass).$json_create(hash);
            }
            else {
              return hash;
            }
          }
      }
    };
  

    (function(self) {
      var $scope = self._scope, def = self._proto;

      return self.$attr_accessor("create_id")
    })(self.$singleton_class());

    self['$create_id=']("json_class");

    $opal.defs(self, '$[]', function(value, options) {
      var $a, $b, self = this;

      if (options == null) {
        options = $hash2([], {})
      }
      if ((($a = (($b = $scope.String) == null ? $opal.cm('String') : $b)['$==='](value)) !== nil && (!$a._isBoolean || $a == true))) {
        return self.$parse(value, options)
        } else {
        return self.$generate(value, options)
      };
    });

    $opal.defs(self, '$parse', function(source, options) {
      var self = this;

      if (options == null) {
        options = $hash2([], {})
      }
      return self.$from_object($parse(source), options);
    });

    $opal.defs(self, '$parse!', function(source, options) {
      var self = this;

      if (options == null) {
        options = $hash2([], {})
      }
      return self.$parse(source, options);
    });

    $opal.defs(self, '$from_object', function(js_object, options) {
      var $a, $b, $c, $d, self = this;

      if (options == null) {
        options = $hash2([], {})
      }
      ($a = "object_class", $b = options, ((($c = $b['$[]']($a)) !== false && $c !== nil) ? $c : $b['$[]=']($a, (($d = $scope.Hash) == null ? $opal.cm('Hash') : $d))));
      ($a = "array_class", $b = options, ((($c = $b['$[]']($a)) !== false && $c !== nil) ? $c : $b['$[]=']($a, (($d = $scope.Array) == null ? $opal.cm('Array') : $d))));
      return to_opal(js_object, options.map);
    });

    $opal.defs(self, '$generate', function(obj, options) {
      var self = this;

      if (options == null) {
        options = $hash2([], {})
      }
      return obj.$to_json(options);
    });

    $opal.defs(self, '$dump', function(obj, io, limit) {
      var $a, self = this, string = nil;

      if (io == null) {
        io = nil
      }
      if (limit == null) {
        limit = nil
      }
      string = self.$generate(obj);
      if (io !== false && io !== nil) {
        if ((($a = io['$responds_to?']("to_io")) !== nil && (!$a._isBoolean || $a == true))) {
          io = io.$to_io()};
        io.$write(string);
        return io;
        } else {
        return string
      };
    });
    
  })(self);
  (function($base, $super) {
    function $Object(){};
    var self = $Object = $klass($base, $super, 'Object', $Object);

    var def = self._proto, $scope = self._scope;

    return ($opal.defn(self, '$to_json', function() {
      var self = this;

      return self.$to_s().$to_json();
    }), nil) && 'to_json'
  })(self, null);
  (function($base, $super) {
    function $Array(){};
    var self = $Array = $klass($base, $super, 'Array', $Array);

    var def = self._proto, $scope = self._scope;

    return (def.$to_json = function() {
      var self = this;

      
      var result = [];

      for (var i = 0, length = self.length; i < length; i++) {
        result.push((self[i]).$to_json());
      }

      return '[' + result.join(', ') + ']';
    
    }, nil) && 'to_json'
  })(self, null);
  (function($base, $super) {
    function $Boolean(){};
    var self = $Boolean = $klass($base, $super, 'Boolean', $Boolean);

    var def = self._proto, $scope = self._scope;

    return (def.$to_json = function() {
      var self = this;

      return (self == true) ? 'true' : 'false';
    }, nil) && 'to_json'
  })(self, null);
  (function($base, $super) {
    function $Hash(){};
    var self = $Hash = $klass($base, $super, 'Hash', $Hash);

    var def = self._proto, $scope = self._scope;

    return (def.$to_json = function() {
      var self = this;

      
      var inspect = [], keys = self.keys, map = self.map;

      for (var i = 0, length = keys.length; i < length; i++) {
        var key = keys[i];
        inspect.push((key).$to_s().$to_json() + ':' + (map[key]).$to_json());
      }

      return '{' + inspect.join(', ') + '}';
    ;
    }, nil) && 'to_json'
  })(self, null);
  (function($base, $super) {
    function $NilClass(){};
    var self = $NilClass = $klass($base, $super, 'NilClass', $NilClass);

    var def = self._proto, $scope = self._scope;

    return (def.$to_json = function() {
      var self = this;

      return "null";
    }, nil) && 'to_json'
  })(self, null);
  (function($base, $super) {
    function $Numeric(){};
    var self = $Numeric = $klass($base, $super, 'Numeric', $Numeric);

    var def = self._proto, $scope = self._scope;

    return (def.$to_json = function() {
      var self = this;

      return self.toString();
    }, nil) && 'to_json'
  })(self, null);
  (function($base, $super) {
    function $String(){};
    var self = $String = $klass($base, $super, 'String', $String);

    var def = self._proto, $scope = self._scope;

    return $opal.defn(self, '$to_json', def.$inspect)
  })(self, null);
  (function($base, $super) {
    function $Time(){};
    var self = $Time = $klass($base, $super, 'Time', $Time);

    var def = self._proto, $scope = self._scope;

    return (def.$to_json = function() {
      var self = this;

      return self.$strftime("%FT%T%z").$to_json();
    }, nil) && 'to_json'
  })(self, null);
  return (function($base, $super) {
    function $Date(){};
    var self = $Date = $klass($base, $super, 'Date', $Date);

    var def = self._proto, $scope = self._scope;

    def.$to_json = function() {
      var self = this;

      return self.$to_s().$to_json();
    };

    return (def.$as_json = function() {
      var self = this;

      return self.$to_s();
    }, nil) && 'as_json';
  })(self, null);
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/json.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass, $hash2 = $opal.hash2;

  $opal.add_stubs(['$attr_reader', '$send!', '$new', '$delete', '$to_n', '$from_object', '$succeed', '$fail', '$call', '$parse', '$xhr']);
  ;
  ;
  return (function($base, $super) {
    function $HTTP(){};
    var self = $HTTP = $klass($base, $super, 'HTTP', $HTTP);

    var def = self._proto, $scope = self._scope, TMP_1, TMP_2, TMP_3, TMP_4, TMP_5, TMP_6;

    def.errback = def.json = def.body = def.ok = def.settings = def.callback = nil;
    self.$attr_reader("body", "error_message", "method", "status_code", "url", "xhr");

    $opal.defs(self, '$get', TMP_1 = function(url, opts) {
      var self = this, $iter = TMP_1._p, block = $iter || nil;

      if (opts == null) {
        opts = $hash2([], {})
      }
      TMP_1._p = null;
      return self.$new(url, "GET", opts, block)['$send!']();
    });

    $opal.defs(self, '$post', TMP_2 = function(url, opts) {
      var self = this, $iter = TMP_2._p, block = $iter || nil;

      if (opts == null) {
        opts = $hash2([], {})
      }
      TMP_2._p = null;
      return self.$new(url, "POST", opts, block)['$send!']();
    });

    $opal.defs(self, '$put', TMP_3 = function(url, opts) {
      var self = this, $iter = TMP_3._p, block = $iter || nil;

      if (opts == null) {
        opts = $hash2([], {})
      }
      TMP_3._p = null;
      return self.$new(url, "PUT", opts, block)['$send!']();
    });

    $opal.defs(self, '$delete', TMP_4 = function(url, opts) {
      var self = this, $iter = TMP_4._p, block = $iter || nil;

      if (opts == null) {
        opts = $hash2([], {})
      }
      TMP_4._p = null;
      return self.$new(url, "DELETE", opts, block)['$send!']();
    });

    def.$initialize = function(url, method, options, handler) {
      var $a, self = this, http = nil, payload = nil, settings = nil;

      if (handler == null) {
        handler = nil
      }
      self.url = url;
      self.method = method;
      self.ok = true;
      self.xhr = nil;
      http = self;
      payload = options.$delete("payload");
      settings = options.$to_n();
      if (handler !== false && handler !== nil) {
        self.callback = self.errback = handler};
      
      if (typeof(payload) === 'string') {
        settings.data = payload;
      }
      else if (payload != nil) {
        settings.data = payload.$to_json();
        settings.contentType = 'application/json';
      }

      settings.url  = url;
      settings.type = method;

      settings.success = function(data, status, xhr) {
        http.body = data;
        http.xhr = xhr;
        http.status_code = xhr.status;

        if (typeof(data) === 'object') {
          http.json = (($a = $scope.JSON) == null ? $opal.cm('JSON') : $a).$from_object(data);
        }

        return http.$succeed();
      };

      settings.error = function(xhr, status, error) {
        http.body = xhr.responseText;
        http.xhr = xhr;
        http.status_code = xhr.status;

        return http.$fail();
      };
    
      return self.settings = settings;
    };

    def.$callback = TMP_5 = function() {
      var self = this, $iter = TMP_5._p, block = $iter || nil;

      TMP_5._p = null;
      self.callback = block;
      return self;
    };

    def.$errback = TMP_6 = function() {
      var self = this, $iter = TMP_6._p, block = $iter || nil;

      TMP_6._p = null;
      self.errback = block;
      return self;
    };

    def.$fail = function() {
      var $a, self = this;

      self.ok = false;
      if ((($a = self.errback) !== nil && (!$a._isBoolean || $a == true))) {
        return self.errback.$call(self)
        } else {
        return nil
      };
    };

    def.$json = function() {
      var $a, $b, self = this;

      return ((($a = self.json) !== false && $a !== nil) ? $a : (($b = $scope.JSON) == null ? $opal.cm('JSON') : $b).$parse(self.body));
    };

    def['$ok?'] = function() {
      var self = this;

      return self.ok;
    };

    def['$send!'] = function() {
      var self = this;

      $.ajax(self.settings);
      return self;
    };

    def.$succeed = function() {
      var $a, self = this;

      if ((($a = self.callback) !== nil && (!$a._isBoolean || $a == true))) {
        return self.callback.$call(self)
        } else {
        return nil
      };
    };

    return (def.$get_header = function(key) {
      var self = this;

      return self.$xhr().getResponseHeader(key);;
    }, nil) && 'get_header';
  })(self, null);
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/opal-jquery/http.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $module = $opal.module;

  $opal.add_stubs([]);
  return (function($base) {
    var self = $module($base, 'Kernel');

    var def = self._proto, $scope = self._scope;

    def.$alert = function(msg) {
      var self = this;

      alert(msg);
      return nil;
    }
        ;$opal.donate(self, ["$alert"]);
  })(self)
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/opal-jquery/kernel.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice;

  $opal.add_stubs([]);
  ;
  ;
  ;
  ;
  ;
  return true;
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/opal-jquery.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice;

  $opal.add_stubs([]);
  return $opal.cdecl($scope, 'SYSTEMS', [["Aalzorg", 583.88, 256.93, "A"], ["Aboukir", -419.96, 287.64, "A"], ["Abushiri", -267.59, 326.48, "A"], ["Achilles", 44.86, -132.11, "A"], ["Achnoly", 638.82, 199.14, "A"], ["Achton", 632.32, 190.92, "A"], ["Acoma", 224.42, -62.26, "A"], ["Adler", 155.26, -210.67, "A"], ["Adrar", -4.38, -409.23, "A"], ["Aer (Finnalon 2822+)", 55.15, -187.64, "A"], ["Afleir", -51.28, -2.98, "A"], ["Aggstein", 219.61, -203.11, "A"], ["Aigle", -234.77, -19.07, "A"], ["Albion (LC)", -284.43, 143.52, "A"], ["Aldrecht", 150.83, 88.19, "A"], ["Alexandria (CC)", 110.83, -356.1, "A"], ["Alktral", 724.38, 250.53, "A"], ["Alnadal", 157.31, 20.19, "A"], ["Alta", -191.25, -218.1, "A"], ["Alto", 106.48, -194.18, "A"], ["Altoona (LC)", -256.61, -6.27, "A"], ["Ambatomainty", 701.41, 175.02, "A"], ["Amber", 281.99, -377.92, "A"], ["Ambrose", -226.18, 427.52, "A"], ["Ammon", 624.27, 213.18, "A"], ["Amu Darya", 33.41, -338.23, "A"], ["Anaea", 141.28, -115.62, "A"], ["Andelys", 455.04, -58.52, "A"], ["Angelsey", 124.22, -88.22, "A"], ["Angra", 390.62, -361.19, "A"], ["Annwyn", -297.18, 71.3, "A"], ["Antias", -33.24, -385.42, "A"], ["Aodh", -40.21, -195.32, "A"], ["Aomen", -18.81, -323.12, "A"], ["Aosia", 112.62, -141.19, "A"], ["Apinzel", -447.89, 113.69, "A"], ["Apsalar", -121.36, 562.12, "A"], ["Aquagea", -56.9, -402.98, "A"], ["Aquavita", -296.54, 59.91, "A"], ["Aquileia", -88.44, -27.88, "A"], ["Arcadia (FS)", 253.74, -88.6, "A"], ["Arlanda", -300.53, 380.65, "A"], ["Armstrong", -488.3, 12.61, "A"], ["Arromanches", 431.23, 36.68, "A"], ["Artru", 166.0, -469.81, "A"], ["Arundel", 595.21, -121.35, "A"], ["Athna", -27.06, -354.27, "A"], ["August", -124.02, -115.59, "A"], ["Avranches", 324.65, 102.4, "A"], ["Awyron", -265.18, 411.66, "A"], ["Azur", 651.3, 257.75, "A"], ["Badlands", 421.69, -354.2, "A"], ["Baggville", -308.21, 330.43, "A"], ["Bahl's Retreat", 149.8, -163.6, "A"], ["Balkan", -32.85, 85.03, "A"], ["Ballentine", 236.55, 21.57, "A"], ["Baltar", 488.64, -362.6, "A"], ["Bamburgh", 607.35, -136.46, "A"], ["Banfora", -98.06, -349.68, "A"], ["Bannerhoft", 550.56, 285.39, "A"], ["Barahona", 684.66, 284.05, "A"], ["Bartrock", 590.65, -148.15, "A"], ["Battaraigi", -193.91, 495.75, "A"], ["Bayeux", 551.92, -52.64, "A"], ["Bayis II", -254.16, 166.53, "A"], ["Beauvais", -500.21, 204.07, ""], ["Beckars", -510.1, 128.99, "A"], ["Beils", 155.18, 190.34, "A"], ["Belacruz", 378.02, 179.12, "A"], ["Belamor (Zanzor 2822+)", 61.81, -293.8, "A"], ["Bell (OA)", 535.24, 221.31, "A"], ["Belluevue", -0.03, -79.9, "A"], ["Beowulf", -124.15, 507.22, "A"], ["Bergtatt", 117.22, -375.03, "A"], ["Beta Regulus II", -201.45, 276.41, "A"], ["Bex", 32.25, -46.08, "A"], ["Bhaktapur", 24.48, -78.52, "A"], ["Bhykov", 70.05, -228.3, "A"], ["Biegga", -189.76, 382.35, "A"], ["Bilma", 111.21, 321.11, "A"], ["Blandou", 120.87, -280.96, "A"], ["Blida", 168.3, -240.21, "A"], ["Blommestein", 724.78, 222.87, "A"], ["Blue Sava", -33.31, -66.81, "A"], ["Blueys", 601.61, 296.35, "A"], ["Boara", -310.77, 481.44, "A"], ["Bodnath", 157.54, -259.22, "A"], ["Boeotia", 160.82, -136.23, "A"], ["Bogerth", 67.94, -256.43, "A"], ["Bogrib", -139.18, -305.87, "A"], ["Bonaire", -44.04, -96.42, "A"], ["Borka", -56.6, -325.64, "A"], ["Bossangoa", 731.85, 277.42, "A"], ["Bothwell", 482.58, 23.94, "A"], ["Bougie", -505.77, 215.46, "A"], ["Boulsi", 778.12, 189.99, "A"], ["Braben's Frontier", 580.48, 206.47, "A"], ["Brabent", 174.03, -192.58, "A"], ["Branzoll", 207.09, -175.17, "A"], ["Braum", 103.72, -315.56, "A"], ["Bremen (RWR)", -472.11, 338.42, "A"], ["Brest", 30.76, -303.5, "A"], ["Bringdam", 101.46, -409.11, "A"], ["Brinton", 134.64, -411.52, "A"], ["Brownsville", 6.47, -29.79, "A"], ["Burnt Rock", -328.51, 191.53, "A"], ["Bushmill", 3.03, 329.36, "A"], ["Bye's Ship", -250.98, -493.66, "A"], ["Cabanatuan", 292.49, 448.09, "A"], ["Cadela", 426.67, -390.88, "A"], ["Caerlaverock", 488.18, 43.48, "A"], ["Caesaera", 233.98, 356.37, "A"], ["Caillinius", -130.97, 540.41, "A"], ["Calchedon", -366.94, -96.04, "A"], ["Caledea", -283.32, 215.58, "A"], ["Calingasta", 670.85, 182.79, "A"], ["Calvados", -459.06, -6.63, "A"], ["Caracol", 273.35, 398.82, "A"], ["Carcassonne", 380.38, 18.13, "A"], ["Cardff", -377.87, -6.0, "A"], ["Caria", 157.77, -125.01, "A"], ["Carmelita", 749.43, 237.95, "A"], ["Carnac", 233.81, -24.01, "A"], ["Catroxx", -90.86, -36.36, "A"], ["Cayuga", -280.18, -513.86, "A"], ["Ceará", -221.31, -322.91, "A"], ["Ceiba", 720.2, 266.61, "A"], ["Celebes", 118.08, 75.83, "A"], ["Centavido", 257.72, -368.73, "A"], ["Ceram", -518.54, 171.09, ""], ["Cerignola", -328.01, -286.32, "A"], ["Ceuta", -538.75, 199.65, ""], ["Charleywood", 275.72, -21.72, "A"], ["Chaumont", 360.59, 17.21, "A"], ["Chaville", 17.4, 46.93, "A"], ["Chengdu", -29.58, -170.36, "A"], ["Chennai", 10.05, -374.19, "A"], ["Chillon", 227.85, -242.96, "A"], ["Chimpaw", 45.16, 154.47, "A"], ["Chita", -489.08, 290.19, "A"], ["Chitwan", 18.75, -172.42, "A"], ["Choex", -454.41, -44.65, "A"], ["Chota", 186.62, -21.95, "A"], ["Chouli", 169.58, -287.76, "A"], ["Christiania", 17.53, 366.01, "A"], ["Cilvituk", -493.4, 225.67, ""], ["Conley's Patch", -220.21, 205.82, "A"], ["Conwy", 77.66, -71.33, "A"], ["Cooperland", 567.72, -266.09, "A"], ["Coopertown", -301.67, -455.14, "A"], ["Corfu", 63.57, 322.26, "A"], ["Cork", 525.58, 66.45, "A"], ["Coromodir", 92.16, -466.51, "A"], ["Courtney", 283.73, 4.85, "A"], ["Coyle", 636.8, 170.18, "A"], ["Cranston", -211.47, -336.73, "A"], ["Crawford", 205.87, -276.17, "A"], ["Cree", -189.46, -247.5, "A"], ["Cresson", -269.82, -483.92, "A"], ["Crichton", 589.25, 226.77, "A"], ["Cryfder", -153.29, 493.89, "A"], ["Culmia", 544.08, 240.76, "A"], ["Custozza", -544.64, 355.23, "A"], ["Dagda (LC)", -225.94, 101.6, "A"], ["Dalian", -57.58, -267.29, "A"], ["Dalmantia", 221.37, 166.53, "A"], ["Danli", 667.39, 273.41, "A"], ["Dansur", -74.92, -315.11, "A"], ["Daol", 146.78, -335.26, "A"], ["Ddraig", 750.89, 151.6, "A"], ["Declan II", 362.88, -20.35, "A"], ["Delagoa", -431.53, 360.36, "A"], ["Derby", -488.48, 275.33, ""], ["Desolate Plains", 207.01, -361.32, "A"], ["Devil's Breath", 509.76, 226.3, "A"], ["Deweidewd", -107.28, 283.25, "A"], ["Dhaulgiri", 137.38, -279.6, "A"], ["Dichell", -267.35, 514.63, "A"], ["Dì-fang", -9.65, -297.47, "A"], ["Dili", -55.0, -299.3, "A"], ["Dirkel", -110.19, 522.42, "A"], ["Dirk's Gulf", 228.93, -145.66, "A"], ["Dol", 232.28, -159.97, "A"], ["Domeyko", 679.85, 229.54, "A"], ["Dove", 33.67, 178.55, "A"], ["Dowles", 117.0, -207.46, "A"], ["Dralkig", 516.62, 113.4, "A"], ["Dreadlord", 566.11, 151.57, "A"], ["Dresden", -202.8, 81.31, "A"], ["Du Lac", 344.56, -162.65, "A"], ["Duantia", -340.0, 57.92, "A"], ["Dumassas", 428.87, -321.74, "A"], ["Dunkerque", 272.43, -196.85, "A"], ["Dunklewälderdunklerflüssenschattenwelt (Bob 2822+)", 440.69, 243.84, "A"], ["Durabon", -279.79, -441.33, "A"], ["Duxford", 569.56, 12.63, "A"], ["Duxfort", 203.51, 350.89, "A"], ["Eagle Rest", -244.11, -549.93, "A"], ["EC821-387D", -204.83, 1731.41, "A"], ["Eigerland", 572.24, 187.15, "A"], ["Eion", -357.16, -122.85, "A"], ["Ejeda", 734.35, 140.46, "A"], ["El Kerak", 279.15, -251.21, "A"], ["Elba", -418.22, 302.56, "A"], ["Elbing (FWL)", -65.53, -70.63, "A"], ["Elix", 45.7, 71.02, "A"], ["Emar", 325.04, 344.71, "A"], ["Enkra", 119.29, -410.73, "A"], ["Entalun", 335.78, -0.57, "A"], ["Erdvynn", -453.56, -21.35, "A"], ["Eschenberg", -149.41, 181.55, "A"], ["Espia", -16.91, -389.69, "A"], ["Esztergom", -237.22, -96.95, "A"], ["Everett", 149.75, -91.35, "A"], ["Fable", 193.28, -192.36, "A"], ["Fallen Stars", -479.14, 38.72, "A"], ["Fallry", 587.89, 290.11, "A"], ["False Dawn", 632.7, 288.31, "A"], ["Famdo", 469.55, -369.43, "A"], ["Farcry", -485.1, 248.96, ""], ["Fasa", -144.52, 1624.37, "A"], ["Fathepur", 246.78, -259.76, "A"], ["Fefferfer", 17.14, 203.22, "A"], ["Feijo", 691.06, 250.2, "A"], ["Ferranil", 121.05, 400.59, "A"], ["Ferrara", 272.89, -169.22, "A"], ["Fiery Plains", 363.99, -416.32, "A"], ["Findal", -523.54, 258.92, ""], ["Finmark", -405.35, 332.89, "A"], ["Finse", 531.47, 166.88, "A"], ["Fjaldr", 88.31, -404.57, "A"], ["Fjernet", -397.0, 248.39, "A"], ["Flatspin", 260.08, -385.93, "A"], ["Florarda", 32.03, -256.93, "A"], ["Flychenia", -181.92, -100.89, "A"], ["Flynn", 639.64, 174.67, "A"], ["Frankson", 555.12, -193.26, "A"], ["Fugeres", 555.36, -213.19, "A"], ["Gabenstad", -343.63, 404.22, "A"], ["Gaeri", 665.68, 220.69, "A"], ["Gahral", 120.67, -176.54, "A"], ["Gamlestolen", 601.17, -103.71, "A"], ["Gangtok", 135.2, -472.32, "A"], ["Gardnaus", 118.31, -324.25, "A"], ["Genf", 147.0, -123.18, "A"], ["Gettorf", -213.79, -536.11, "A"], ["Ghorepani", 10.06, -406.49, "A"], ["Gingeria", -544.59, 151.64, "A"], ["Girondas", 152.92, -421.68, "A"], ["Gitarama", 676.5, 263.4, "A"], ["Giverny", 623.21, -84.17, "A"], ["Givrodat", -187.43, 522.38, "A"], ["Glabach", 108.82, 443.25, "A"], ["Glenlivet", 14.5, 174.54, "A"], ["Glitnir", 603.11, 234.85, "A"], ["Gniezno", -127.55, -22.02, "A"], ["Goldlure", 269.0, 108.12, "A"], ["Gorfynt", -233.62, 488.93, "A"], ["Gorgon", -547.28, 267.57, ""], ["Gorki", -15.38, -163.49, "A"], ["Gran", -296.27, -171.18, "A"], ["Grankum", 579.33, 274.3, "A"], ["Gravensteen", 219.61, -133.94, "A"], ["Graz", -216.68, 126.89, "A"], ["Greypearl", 461.44, 254.63, "A"], ["Grobin", -98.68, -68.21, "A"], ["Grootfontein", 97.36, 105.03, "A"], ["Gruyeres", 240.68, -214.56, "A"], ["Guldra", 114.42, -461.16, "A"], ["Gwynedd", -276.41, 459.46, "A"], ["Haddings", -44.03, 13.93, "A"], ["Haerhbin", -6.44, -213.65, "A"], ["Haggard", -477.07, 59.41, ""], ["Hakkaido", 267.64, 228.59, "A"], ["Halgrim", 625.96, 154.39, "A"], ["Halla", 513.8, 204.11, "A"], ["Hanseta", 287.7, -352.31, "A"], ["Hansii (Itsbur 2822+)", 64.18, -362.85, "A"], ["Harbin", 17.61, -223.26, "A"], ["Harlez", -510.43, 147.61, ""], ["Hastur", -82.98, -402.34, "A"], ["Hawktor", 450.7, -333.11, "A"], ["Heart Fjord", -135.27, -203.4, "A"], ["Heathville", -509.83, 91.85, "A"], ["Hechnar", -16.84, -26.08, "A"], ["Hegel", -239.88, 126.15, "A"], ["Heidelburg", -301.16, 508.42, "A"], ["Helduza", -518.08, 279.2, ""], ["Heliat", 124.23, -485.74, "A"], ["Helixmar", 175.55, -203.1, "A"], ["Helland", 489.95, 243.17, "A"], ["Hell's Paradise", -293.76, -65.87, "A"], ["Helvetica", -232.59, -571.42, "A"], ["Herat (FS)", 200.14, -185.66, "A"], ["Herbania", -276.34, 393.05, "A"], ["Hergazil", 646.51, 130.51, "A"], ["Herrmaz", -241.42, -446.32, "A"], ["Hè-shì", 190.39, -305.21, "A"], ["Hiberius", -513.02, 65.02, "A"], ["Hibuarius", -38.68, -410.74, "A"], ["Hildaman", 170.52, 90.26, "A"], ["Hirtshals", -329.07, 507.8, "A"], ["Hódmezovásárhely", -193.28, -142.51, "A"], ["Hoensbroek", 485.28, -130.97, "A"], ["Hornir's Keep", -258.37, -33.63, "A"], ["Hrafn", 618.55, 232.6, "A"], ["Huesta", -431.95, 34.13, "A"], ["Hurgh", 129.04, -171.02, "A"], ["Ichlangis", 101.66, -401.22, "A"], ["Ichmandu", -82.9, 525.21, "A"], ["Ictus", 547.27, 186.2, "A"], ["Ife", 71.49, -288.14, "A"], ["Ildlandet", -241.13, -320.68, "A"], ["Ilion", -285.3, -28.83, "A"], ["Illium", -207.38, 439.23, "A"], ["Ilmachna", -3.35, -108.45, "A"], ["Ilmar", 48.8, -170.54, "A"], ["Ina", 199.01, -391.11, "A"], ["Indrapurai", -539.37, 176.88, "A"], ["Inglesmond", 33.9, 33.94, "A"], ["Inner Surge", -471.85, 321.89, "A"], ["Iron Land", -88.31, 445.55, "A"], ["Isfahan", 163.23, 460.22, "A"], ["Itica", -64.06, -373.08, "A"], ["Itrom", 92.46, -442.68, "A"], ["Itzehoe", -76.48, -518.77, "A"], ["Izmir", -340.86, -268.17, "A"], ["Jacobabad", 407.87, -283.42, "A"], ["Janina", -446.61, 173.84, "A"], ["Jápminboddu", -220.28, 510.01, "A"], ["Jardangal", -546.02, 290.19, ""], ["Jardine (Herakleion)", -200.94, -91.2, "A"], ["Jászberény", -105.57, -142.41, "A"], ["Java", 2.72, -241.82, "A"], ["Jeju", 212.59, 443.06, "A"], ["Jenet", 191.66, -253.95, "A"], ["Jeppens", 589.91, 111.75, "A"], ["Jilin", -6.22, -114.94, "A"], ["Joan's Post", 509.8, 245.11, "A"], ["Johnson", 531.76, 252.29, "A"], ["Jorvikland", -210.49, 307.66, "A"], ["Joshua", 625.49, 129.65, "A"], ["Josselin", 374.88, 6.22, "A"], ["Jungar Qi", 15.54, -281.9, "A"], ["Kaldu", 599.07, 180.04, "A"], ["Kalmar (CC)", -67.58, -302.28, "A"], ["Kannon", -11.93, 124.44, "A"], ["Kanto", 330.78, 283.81, "A"], ["Karlstejn", -52.47, -290.76, "A"], ["Katinka", 151.69, -451.19, "A"], ["Katla", -59.63, -341.02, "A"], ["Kaufermann", 405.8, -100.73, "A"], ["Kautokeino", 241.74, -311.82, "A"], ["Kazu", 101.12, -364.21, "A"], ["Kek", 105.02, -153.21, "A"], ["Kenilworth", 561.6, -161.56, "A"], ["Kent", 693.25, 128.01, "A"], ["Kerman", -466.19, 200.83, "A"], ["Kern", 126.17, -384.04, "A"], ["Khi", 134.04, -205.93, "A"], ["Ki Zoban", 446.07, 132.28, "A"], ["Kievanur", -55.49, -152.46, "A"], ["Killbourn", -5.08, 13.11, "A"], ["Kimi", 51.85, -410.67, "A"], ["Kingtribel", 32.59, 142.44, "A"], ["Kirkvåg (Toch Zu 2822+)", 64.33, -317.16, "A"], ["Kiruna", 125.32, 411.36, "A"], ["Kitopler", -427.83, 100.08, "A"], ["Klamriz V", 205.91, -8.58, "A"], ["Klayne", -11.54, -242.39, "A"], ["Klenkar", 409.94, -377.68, "A"], ["Knutdor", 145.17, -194.64, "A"], ["Knutstad", 349.39, 481.25, ""], ["Kohlman", 20.58, -198.3, "A"], ["Kola", -265.49, 439.57, "A"], ["Köln (FWL)", -150.07, -153.99, "A"], ["Kolobrzeg", -130.24, -45.58, "A"], ["Konopiste", -44.04, -285.56, "A"], ["Korvitz", 336.41, -100.73, "A"], ["Koskenkorva", -214.39, 474.35, "A"], ["Koury", 595.14, 250.79, "A"], ["Krakatau", 54.9, -344.94, "A"], ["Kreller", -59.83, 352.9, "A"], ["Kristiandsund", -9.19, -83.56, "A"], ["Kublenz", 505.58, -32.26, "A"], ["Kumqwat", 155.69, -265.59, "A"], ["Kupang (CC)", -51.33, -273.65, "A"], ["Kupang (RWR)", -499.07, 262.61, "A"], ["La Ligua", 754.02, 222.39, "A"], ["Lacadon", 133.72, -135.55, "A"], ["Lamu (Tunlmar 2822+)", 51.24, -233.76, "A"], ["Lande", -502.78, 73.45, ""], ["Laong", 114.53, -223.08, "A"], ["Las Tunas", 693.4, 269.41, "A"], ["Leh", 441.51, -376.03, "A"], ["Lhasa", 91.81, -164.96, "A"], ["Linden", 737.65, 261.96, "A"], ["Linhauiguan", 15.77, -425.72, "A"], ["Lintz", -172.14, 138.45, "A"], ["Lochmantle", 138.3, -327.7, "A"], ["Lockdale", 40.28, 2.57, "A"], ["Logres", -317.92, 175.65, "A"], ["Loikaw", 727.62, 203.96, "A"], ["Lokoja", -379.62, 434.3, "A"], ["Lone Star", -4.66, 50.42, "A"], ["Lorkdal", 421.01, -343.75, "A"], ["Luanda", -368.13, 370.72, "A"], ["Lucknow", 73.03, -337.09, "A"], ["Luderitz", 483.22, -398.62, "A"], ["Lukla", -53.62, -225.55, "A"], ["Luxani", -268.66, -418.3, "A"], ["Lynchburg", 340.72, -128.14, "A"], ["Lyreton", 59.06, -420.68, "A"], ["Machapuchre", -321.0, 420.35, "A"], ["Mackolla", 637.58, -110.13, "A"], ["Maharet", 147.92, -234.49, "A"], ["Mahrah", -417.56, 214.69, "A"], ["Maison", 332.97, -112.88, "A"], ["Malacca", -493.8, 150.94, ""], ["Malaga", -489.67, 305.3, ""], ["Malazan", -282.66, -43.91, "A"], ["Maldive", 138.07, -364.57, "A"], ["Manaus", -152.61, -361.23, "A"], ["Mandal", -8.77, -55.98, "A"], ["Mandeville", 700.4, 196.16, "A"], ["Manennaia", 27.68, -89.52, "A"], ["Mangor", -153.2, -370.69, "A"], ["Mangzhangdian", 111.94, -433.68, "A"], ["Manksville", 388.4, -22.87, "A"], ["Manx", -182.05, 317.0, "A"], ["Mao", -355.74, 456.94, "A"], ["Marathon", -150.91, -278.78, "A"], ["Maripa", 754.26, 203.79, "A"], ["Marisura", -434.85, 207.4, "A"], ["Marsalle", -333.97, 25.18, "A"], ["Mas", 227.33, -425.51, "A"], ["Masterton", 292.6, -369.76, "A"], ["Mattisskogen", -58.66, -361.37, "A"], ["Mavegh", 320.85, -335.54, "A"], ["Mayenne", -547.12, 241.56, "A"], ["Mazdru", 92.73, -321.52, "A"], ["McKellan", -225.06, 74.03, "A"], ["Mearra", -245.97, 502.42, "A"], ["Mechdur", 112.42, -423.35, "A"], ["Medron", 424.16, 114.42, "A"], ["Megaris", 196.14, -395.65, "A"], ["Meghy", -518.68, 156.82, ""], ["Megiddo", -507.43, 344.48, ""], ["Meinhof", 196.25, -147.84, "A"], ["Melilla", -530.98, 213.03, ""], ["Melk", -386.21, -213.07, "A"], ["Melville", -303.63, 405.77, "A"], ["Menion", 187.02, -394.47, "A"], ["Merdal", 91.9, -390.71, "A"], ["Merlin", 170.29, -364.5, "A"], ["Merlynpede", -475.51, 96.73, ""], ["Merowinger", 576.43, -193.95, "A"], ["Michtal", 561.77, 263.42, "A"], ["Mickleover", -474.1, 358.9, "A"], ["Midthun", 74.4, -384.04, "A"], ["Milvano", -463.1, 20.39, "A"], ["Mindrel", 547.5, 207.41, "A"], ["Miyako", 245.42, 237.75, "A"], ["Miyazaki", 51.43, 57.51, "A"], ["Mizt", 632.62, 251.09, "A"], ["Modesto", -142.03, -536.5, "A"], ["Mogabouti", -365.66, 384.66, "A"], ["Mohács", -267.78, -180.67, "A"], ["Mokpo", 232.82, 221.26, "A"], ["Mondra", -317.02, -403.34, "A"], ["Monthey", -504.79, 53.38, "A"], ["Montsegur", -253.09, 383.13, "A"], ["Morrigan", -333.15, 71.82, "A"], ["Mumbai", 25.3, -248.93, "A"], ["Murmansk", 320.53, 221.95, "A"], ["Muroto", 212.52, 182.93, "A"], ["Murris (Kalindam 2822+)", 52.22, -379.33, "A"], ["Muswell", 35.24, 289.65, "A"], ["Myrrdin", -388.53, 62.77, "A"], ["Myrvoll", -17.66, -88.6, "A"], ["Mytilene", 151.17, -135.63, "A"], ["Naco", -522.16, 232.81, ""], ["Naikongzu", 527.11, 360.78, ""], ["Naissus", -347.18, -162.06, "A"], ["Nai-Stohl", 1.5, 72.4, "A"], ["Nam Dinh", -66.68, -251.43, "A"], ["Namen", 171.97, -215.71, "A"], ["Nara", 292.71, 296.54, "A"], ["Naryn", -37.19, -361.15, "A"], ["Nerum", 610.82, 264.27, "A"], ["New Ålborg", -112.26, 447.54, "A"], ["New Athens", 59.75, -129.94, "A"], ["New Ceylon", 148.31, 433.57, "A"], ["New Crete", 39.83, -200.51, "A"], ["New Dallas", -54.99, -25.46, "A"], ["New Florence", 90.61, -11.64, "A"], ["New Galicia", -364.78, -217.92, "A"], ["New Praha", -104.54, -175.75, "A"], ["New Sapporo", 332.96, 417.3, "A"], ["New Sarum", 228.76, 424.37, "A"], ["New Stevens", 22.35, -6.07, "A"], ["New Sumatra", 139.37, 64.38, "A"], ["New Troy", -51.11, -259.91, "A"], ["Nexus Ri", 417.21, 207.87, "A"], ["Nichol's Rest", -265.87, 69.61, "A"], ["Nightwish", -446.9, 4.26, "A"], ["Nis", 249.84, -187.99, "A"], ["Nito", -557.01, 226.98, "A"], ["Nobel", -166.41, -426.65, "A"], ["Nogales", 269.69, -218.38, "A"], ["Noh-wan Hohm", 155.02, -178.38, "A"], ["Non Diz", 146.99, -369.07, "A"], ["Northsun", 503.51, 213.82, "A"], ["Nouveau Toulouse", 284.34, 60.73, "A"], ["Nuelson Minor", -345.72, 171.9, "A"], ["Nukus", -2.09, -320.6, "A"], ["Nyasa", -413.73, 394.3, "A"], ["Odawara", 235.8, 265.69, "A"], ["Okaya", 108.91, 38.04, "A"], ["Old Canton", 393.59, 260.66, "A"], ["Oldsmith", 306.33, 88.67, "A"], ["Oli", 136.5, -151.26, "A"], ["Oligar", 89.78, -270.84, "A"], ["Onverwacht", 679.53, 157.62, "A"], ["Ordino", 42.02, -362.74, "A"], ["Ormal", 420.01, -68.22, "A"], ["Osset", 458.47, 227.93, "A"], ["Osumi", 74.11, 138.81, "A"], ["Ourem", 658.89, 293.36, "A"], ["Oyevaina", 37.67, 264.05, "A"], ["Paches", 154.56, -142.77, "A"], ["Paf", 188.69, -436.12, "A"], ["Panzyr", 86.77, -429.62, "A"], ["Pardeau", -149.63, -5.17, "A"], ["Parian", 187.35, -382.63, "A"], ["Parvan", -465.13, 142.85, "A"], ["Pasemah", -513.09, 180.88, "A"], ["Patan", 92.96, -261.97, "A"], ["Pavia", -65.72, -112.03, "A"], ["Payia", 35.24, -406.48, "A"], ["Pec", -156.61, -224.8, "A"], ["Pell", 16.09, -334.88, "A"], ["Pentvar", 131.66, -301.13, "A"], ["Périgueux", 342.59, 82.49, "A"], ["Pernik", -83.63, -335.94, "A"], ["Pietermaritzburg", 193.95, -288.54, "A"], ["Pilon", 778.43, 199.98, "A"], ["Plataea", 113.11, -122.49, "A"], ["Pliska", -48.31, -65.6, "A"], ["Pokhara", 62.36, 16.82, "A"], ["Pressby", -215.3, -14.88, "LC,Protectorate of Donegal,Bolan Province"], ["Pressville", -550.94, 335.75, "A"], ["Prydain", -269.75, 247.1, "A"], ["Pula", 269.23, -230.9, "A"], ["Puttalam", 736.8, 184.39, "A"], ["Qalzi", 161.83, -436.82, "A"], ["Quelimane", -471.12, 380.66, "A"], ["Quimper", 308.47, -138.83, "A"], ["Quines", 725.82, 238.05, "A"], ["Raetia", 575.21, 245.55, "A"], ["Ragusa", -99.44, -193.8, "A"], ["Ramen II", -28.01, -152.96, "A"], ["Reinbak", -112.1, -522.3, "A"], ["Reinhardstein", 192.12, -111.27, "A"], ["Rennes", 507.26, -200.59, "A"], ["Renorsal", 616.8, 262.98, "A"], ["Renren", -177.38, 407.08, "A"], ["Restitution", -204.96, -344.97, "A"], ["Revel", -400.91, -232.13, "A"], ["Rhodos (Runrig 2822+)", 48.93, -217.14, "A"], ["Rochers", -278.46, -15.98, "A"], ["Rocky", -16.69, 24.72, "A"], ["Rondon", 714.67, 134.51, "A"], ["Roscoff", 546.81, 43.17, "A"], ["Rosendal", -42.17, -341.9, "A"], ["Rosetta", -462.87, 226.33, ""], ["RWR Outpost #11", 777.33, -1437.09, "A"], ["RWR Outpost #4", 1720.56, 424.58, "A"], ["RWR Outpost #7", 1628.38, -73.44, "A"], ["Ryans Fate", 90.21, -416.56, "A"], ["Rypful", -506.04, 367.02, ""], ["Sabhal Mòr Ostaig", -253.54, 237.28, "A"], ["Salardion", -37.92, -394.62, "A"], ["Salisberg", -315.42, 454.77, "A"], ["Saltural", 253.04, -43.94, "A"], ["Saltville", 377.94, -99.44, "A"], ["Salvende", 640.21, 278.42, "A"], ["San Carlos", 454.87, -394.18, "A"], ["Santa-Ana", 668.72, 200.82, "A"], ["Santiago", 400.93, 173.62, "A"], ["Sanurcha", 217.52, -302.84, "A"], ["Sanurcha (Ildrong 2750+)", 430.31, -219.14, "A"], ["Sappho", -59.81, -240.67, "A"], ["Sardis", -262.27, -164.01, "A"], ["Sarkel", -89.84, -97.99, "A"], ["Saumur", 377.79, 69.13, "A"], ["Schmitt", -304.74, -430.2, "A"], ["Schrim", 616.31, 199.87, "A"], ["Sebha", 422.9, -412.79, "A"], ["Segerica", -27.28, -406.94, "A"], ["Sendai", 62.14, 166.42, "A"], ["Sentarus", -220.45, 523.32, "A"], ["Serenity", 390.62, -396.53, "A"], ["Seuta Bimyeong", 266.09, 359.23, "A"], ["Shalaine", -529.32, 129.21, ""], ["Shardayne", 4.58, 247.12, "A"], ["Sharpe", 63.64, -207.46, "A"], ["Shaun (Burl 2822+)", 53.27, -328.06, "A"], ["Shimoda", 265.12, 263.63, "A"], ["Shipton", -152.77, -517.69, "A"], ["Shira", 700.52, 236.5, "A"], ["Shiri", 653.63, 150.62, "A"], ["Shui-pào", -7.79, -134.26, "A"], ["Sialkot", -487.84, 237.51, ""], ["Sichuan", 35.53, -108.34, "A"], ["Sidon", -465.2, 183.87, ""], ["Sikkim", 331.77, 330.96, "A"], ["Sileste", -535.34, 314.4, "A"], ["Simancas", 398.86, -123.71, "A"], ["Simone", 387.55, -377.92, "A"], ["Sindalin", 104.84, -338.74, "A"], ["Skaslien", 220.52, -191.97, "A"], ["Skiland", -83.83, 545.68, "A"], ["Smithon", 126.5, -432.67, "A"], ["Smythe", 207.45, -208.28, "A"], ["Snailzar", 21.04, -101.42, "A"], ["Snowdon", -343.95, 476.79, "A"], ["Solor", -485.08, 166.13, "A"], ["Sornath", 673.16, 124.83, "A"], ["Sorsk", 717.09, 183.09, "A"], ["Sparta", -219.54, -207.59, "A"], ["Spirit", -222.81, -117.55, "A"], ["St. Cyr", 510.01, -110.13, "A"], ["St. Gall", -74.86, -87.66, "A"], ["Staffin", 105.8, -178.03, "A"], ["Stardawn", -335.14, 112.58, "A"], ["Starshine", -373.71, -37.19, "A"], ["Stellaris", -300.27, 105.71, "A"], ["Stettin (FWL)", -341.98, -294.98, "A"], ["Stirling", -424.18, 179.24, "A"], ["Stockpoll", 187.31, -168.3, "A"], ["Stonarboi", -99.12, 309.72, "A"], ["Sturganos", 370.76, -45.77, "A"], ["Styriania", -503.42, 328.21, "A"], ["Summerstide", 533.35, -141.27, "A"], ["Sumy", 37.99, -289.23, "A"], ["Sunchon", 274.51, 208.43, "A"], ["Sunnywood", 61.13, -400.76, "A"], ["Svalstad", -298.05, 433.06, "A"], ["Swales", 302.36, 34.92, "A"], ["Sweet Water", -373.83, 312.72, "A"], ["Synsstad", -446.9, 251.38, "A"], ["Szepes", -232.29, -63.08, "A"], ["Szombathely", -182.31, -84.03, "A"], ["Talisker", 29.07, 130.2, "A"], ["Tallassee", 146.78, 3.93, "A"], ["Tangerz ('Mayadi')", 158.38, 106.75, "A"], ["Tantallon", 488.94, 0.49, "A"], ["Tanz", 651.51, 229.54, "A"], ["Taran's World", -59.95, 505.53, "A"], ["Tatopani", -475.17, -7.04, "A"], ["Taumaturgo", 706.7, 290.87, "A"], ["Tazaraki", 182.5, -262.43, "A"], ["Tedibyhr", 124.79, -63.4, "A"], ["Tengil", -65.3, -311.9, "A"], ["Tetschner", 96.59, -292.25, "A"], ["Tetski", -125.75, -475.26, "A"], ["Teylingen", 417.94, -119.06, "A"], ["Thazi", 775.43, 181.3, "A"], ["Thirty Weight", -246.44, -152.84, "A"], ["Tianamon", 98.68, -83.79, "A"], ["Tintavel", -98.38, -243.79, "A"], ["Tirabad", 339.02, -389.93, "A"], ["Tiruchchirappalli", 385.12, -257.92, "A"], ["Tordenskjold", -231.69, 544.39, "A"], ["Torgvei", -438.58, 379.83, "A"], ["Toten", 568.0, 92.9, "A"], ["Totness", 664.94, 171.24, "A"], ["Tottori", 430.7, 265.01, "A"], ["Tovetin", 37.0, 426.24, "A"], ["Traussin", 358.27, -318.86, "A"], ["Tresspass", 525.91, 266.22, "A"], ["Tuat", 113.04, 290.88, "A"], ["Turkalia", 303.89, 25.23, "A"], ["Turko", 160.03, -190.21, "A"], ["Turov", -317.22, -221.73, "A"], ["Tylarzka", -294.39, -16.81, "A"], ["Tyrfing", -33.12, -28.32, "A"], ["Tyrlon", 115.75, -446.47, "A"], ["Ubangi", -383.65, 412.59, "A"], ["Ugland", 557.63, 107.98, "A"], ["Ukunela", -282.64, 85.28, "A"], ["Ullieri", -31.41, -306.17, "A"], ["Ulsan", 194.57, 275.08, "A"], ["Ulubis", 562.02, 230.61, "A"], ["Ulvskollen", 582.38, -207.23, "A"], ["Umgard", 124.33, -419.08, "A"], ["Undra", 113.56, -116.1, "A"], ["Unkador", 369.85, -77.83, "A"], ["Untran (Achtur 2822+)", 43.56, -421.61, "A"], ["Vaajakoski", 119.0, 158.05, "A"], ["Valabhi", -414.7, 239.66, "A"], ["Valdives", 98.85, -371.58, "A"], ["Valladolid", -556.33, 200.5, ""], ["Valois", 589.49, -166.24, "A"], ["Vangburg", 614.0, 267.84, "A"], ["Vargtass", -236.65, 467.5, "A"], ["Várri", -266.42, 480.2, "A"], ["Vecchio", 247.7, -137.0, "A"], ["Verdinge", 517.12, -6.38, "A"], ["Vereeniging", 417.33, -163.87, "A"], ["Versailles", 206.93, -81.73, "A"], ["Vicksland", -263.03, -116.43, "A"], ["Victralla", 280.27, -342.1, "A"], ["Viluisk", -437.34, 345.1, "A"], ["Vinstra", 516.13, 186.16, "A"], ["Vintru", 116.31, -159.51, "A"], ["Viribium", -53.62, -389.08, "A"], ["Viroflay", -569.84, 177.96, ""], ["Voehn", 598.88, 195.74, "A"], ["Vonja", 648.97, 115.77, "A"], ["Vortalcoy", -485.1, 81.77, "A"], ["Vulture's Nest", -241.64, 416.98, "A"], ["Waini Point", 732.5, 165.03, "A"], ["Waitur", 621.95, 109.63, "A"], ["Wantorill", 84.41, -303.15, "A"], ["Warrumbungle", -194.16, 195.28, "A"], ["Waycross", 141.12, -22.79, "A"], ["Wedderborg", 472.22, -85.39, "A"], ["Weitinger", 125.02, -343.96, "A"], ["Weiz", 177.43, -249.21, "A"], ["Weldry", 73.94, -417.25, "A"], ["Werfer", 237.27, -344.03, "A"], ["Westfield", 235.57, 107.67, "A"], ["Westphalia", 125.25, -103.71, "A"], ["Windhoek", -349.23, 442.37, "A"], ["Wingzar", -465.85, 130.31, ""], ["Wittington", 424.2, 105.47, "A"], ["Wokha", 751.78, 167.11, "A"], ["Wonju", 266.75, 414.0, "A"], ["Woogi", 226.86, -412.08, "A"], ["Wynn's Roost", 610.61, 269.93, "A"], ["Wypoute", -335.57, 369.17, "A"], ["Yamoussoukra", 504.06, -67.99, "A"], ["Yàn-huì", 55.62, -273.65, "A"], ["Yidtall", -479.6, -25.87, "A"], ["Ylemelke", -234.23, 451.71, "A"], ["Yongd", 113.19, -309.01, "A"], ["Ype-Jhu", 674.29, 138.33, "A"], ["Yufu", 231.78, 119.7, "A"], ["Zacatecoluca", 385.88, -217.77, "A"], ["Zalt", 661.83, 248.29, "A"], ["Zalzangor", 266.48, -327.09, "A"], ["Zambezi", 388.17, -188.61, "A"], ["Zanbasa", -316.66, 458.8, "A"], ["Zangul", 119.8, -402.48, "A"], ["Zara (FWL)", -140.86, -219.6, "A"], ["Zathras", -84.04, -390.39, "A"], ["Zawiercie", 266.26, 167.21, "A"], ["Zebrenaski", -287.41, -99.77, "A"], ["Zebuluraskai", 616.79, 266.34, "A"], ["Zefri", -490.41, 238.3, ""], ["Zelmag III", -265.98, -401.8, "A"], ["Zelski II", 324.1, -427.16, "A"], ["Zempoatlepetl", -212.18, -139.05, "A"], ["Zertarum", -135.54, 460.18, "A"], ["Zetang", 692.74, 216.71, "A"], ["Zinal", -515.49, 110.03, ""], ["Zindao", 105.51, -241.56, "A"], ["Zuhbehr", -351.88, -38.23, "A"], ["Zumbo", 711.44, 162.88, "A"], ["Atreus (Clan)", 71.78, 1732.83, "C"], ["Circe", -122.48, 1613.57, "C"], ["Delios", -16.79, 1803.51, "C"], ["Eden", -133.35, 1612.49, "C"], ["Lum", 5.79, 1756.49, "C"], ["New Kent", 120.78, 1783.02, "C"], ["Paxon", -70.83, 1878.23, "C"], ["Priori", 3.73, 1806.48, "C"], ["Radulov (Tanis 2600+)", -57.28, 1601.9, "C"], ["Tranquil", 124.76, 1756.46, "C"], ["Vinton", 7.65, 1910.76, "C"], ["York (Clan)", -70.86, 1805.59, "C"], ["Albion (Clan)", -50.2, 1790.73, "CB"], ["Necromo", 102.88, -188.47, "CC,Capella Commonality,Region 4"], ["Mitchel", 108.81, -328.31, "CC,Sian Commonality,Region 11"], ["Buenos Aires", 18.09, -341.99, "CC,Sian Commonality,Region 8"], ["Attenbrooks", -71.71, 985.31, ""], ["Hardisey's Haven", -414.63, -91.68, "CF"], ["Circinus", -388.56, -66.82, "CF,Faction Capital"], ["Shadow", -2.05, 1748.52, "CFM,Faction Capital"], ["Trelleborg", 109.18, 919.85, ""], ["Cambridge Perimeter Defense Station", -300.59, 640.31, ""], ["Santiago IV", -365.69, 930.27, ""], ["St. Jean", -467.05, 1065.17, ""], ["Transfer Station J239H2", -168.87, 611.73, ""], ["Ironhold", 46.15, 1743.58, "CJF,Faction Capital"], ["Ctesiphon", 321.43, 1044.12, ""], ["Salonika", 435.9, 973.06, ""], ["Epsilon Pegasus (Columbus)", 404.69, 601.38, "CS"], ["Ghent", 211.08, 1163.57, ""], ["Nouveaux Paris", 129.6, 843.17, ""], ["Ramsey", -402.38, 1025.14, ""], ["Wark", -299.33, 694.32, ""], ["Sigurd", -103.89, 479.71, "OC"], ["Transfer Station P3", -112.32, 884.95, ""], ["Transfer Station P9", -115.35, 1036.84, ""], ["Wolf Orbital 82", -103.77, 683.28, ""], ["An Ting", 301.65, 109.81, "DC,Galedon Military District,Matsuida Prefecture"], ["Bergman's Planet", 265.98, 74.91, "FS,Draconis March,Robinson Operational Area,Raman PDZ"], ["Galedon V", 332.0, 173.89, "DC,Galedon Military District,New Samarkand Prefecture,Major Capital"], ["Radstadt", 41.37, 316.63, "DC,Rasalhague Military District,Radstadt Prefecture,Minor Capital"], ["Verlo", 100.55, -303.04, "FS,Capellan March,Taygeta Operational Area,Sirdar PDZ"], ["Galax", 283.63, -124.55, "FS,Crucis March,Markesan Operational Area,New Avalon Combat Region"], ["Benet III", 262.88, 58.11, "FS,Draconis March,Robinson Operational Area,Raman PDZ"], ["Diamantina", -314.9, -99.56, "FWL"], ["Lopez", -37.76, -330.4, "FWL,Duchy of Andurien"], ["Paradise", -239.91, -126.4, "FWL,Duchy of Graham-Marik"], ["Fletcher (FWL)", -67.73, -209.97, "FWL,Duchy of Oriente"], ["Gibson", -245.81, -215.13, "FWL,Principality of Gibson"], ["Keeling", -173.75, -217.41, "FWL,Principality of Regulus"], ["Alarion", -319.71, 138.6, "LC,Protectorate of Donegal,Alarion Province,Minor Capital"], ["Ridderkerk", -46.27, 351.25, "LC,Tamar Pact,Tamar Domains"], ["Vantaa", -72.64, 351.51, "LC,Tamar Pact,Trellshire"], ["Halfway", -252.55, 86.03, "LC,Protectorate of Donegal,Bolan Province"], ["Poulsbo", -375.35, -63.64, "LC,Protectorate of Donegal,Alarion Province"], ["Weistheimer", -244.91, -519.16, "A"], ["Gant", 311.29, -460.55, "U"], ["Micros III", 361.5, -433.5, "U"], ["Aea", 156.05, -426.17, "U"], ["Colleen", -146.6, 1836.4, "U"], ["Úr Cruinne", -15.22, -471.94, "U"], ["Colchis", 458.02, -498.37, "U"], ["Bithinia", -18.88, -178.46, "CC,Capella Commonality,Region 1"], ["Ingersoll", -5.18, -172.21, "CC,Capella Commonality,Region 1"], ["Masterson", 2.76, -185.77, "CC,Capella Commonality,Region 1"], ["Propus", -12.42, -183.81, "CC,Capella Commonality,Region 1"], ["Aldertaine", 44.71, -191.04, "CC,Capella Commonality,Region 2"], ["Bandora", 13.18, -177.37, "CC,Capella Commonality,Region 2"], ["Cordiagr", 24.3, -191.04, "CC,Capella Commonality,Region 2"], ["Geifer", 37.54, -186.27, "CC,Capella Commonality,Region 2"], ["Capella", 38.13, -172.16, "CC,Capella Commonality,Region 2,Major Capital"], ["Gei-Fu", 57.64, -199.07, "CC,Capella Commonality,Region 3"], ["No Return", 56.33, -177.36, "CC,Capella Commonality,Region 3"], ["Randar", 61.77, -175.78, "CC,Capella Commonality,Region 3"], ["Relevow", 70.31, -188.27, "CC,Capella Commonality,Region 3"], ["Ares", 95.38, -173.99, "CC,Capella Commonality,Region 4"], ["Capricorn III", 87.62, -186.38, "CC,Capella Commonality,Region 4"], ["Minnacora", 77.29, -170.62, "CC,Capella Commonality,Region 4"], ["New Sagan", 79.87, -177.66, "CC,Capella Commonality,Region 4"], ["Boardwalk", -13.7, -197.58, "CC,Capella Commonality,Region 5"], ["Eom", -18.04, -191.79, "CC,Capella Commonality,Region 5"], ["Exedor", -13.2, -207.89, "CC,Capella Commonality,Region 5"], ["Jasmine", -31.03, -202.15, "CC,Capella Commonality,Region 5"], ["Kashilla", -1.55, -201.15, "CC,Capella Commonality,Region 6"], ["Kurragin", 3.35, -203.23, "CC,Capella Commonality,Region 6"], ["Glasgow", 28.43, -215.62, "CC,Capella Commonality,Region 7"], ["Ovan", 30.49, -205.81, "CC,Capella Commonality,Region 7"], ["Overton", 46.25, -207.89, "CC,Capella Commonality,Region 7"], ["Preston (CC)", 13.18, -214.04, "CC,Capella Commonality,Region 7"], ["Campertown", -5.44, -159.33, "CC,Sarna Commonality,Region 6"], ["Chamdo", 10.33, -152.29, "CC,Sarna Commonality,Region 6"], ["Lesalles", 9.82, -164.98, "CC,Sarna Commonality,Region 6"], ["New Sarna (Tsinghai)", -2.85, -152.29, "CC,Sarna Commonality,Region 6"], ["Old Kentucky", 2.06, -141.69, "CC,Sarna Commonality,Region 6"], ["Phact", 10.85, -139.9, "CC,Sarna Commonality,Region 6"], ["Raballa", 21.71, -157.74, "CC,Sarna Commonality,Region 6"], ["Wazan", 5.94, -140.69, "CC,Sarna Commonality,Region 6"], ["Corey", 21.44, -136.23, "CC,Sarna Commonality,Region 3"], ["Ulan Bator", 35.92, -139.4, "CC,Sarna Commonality,Region 4"], ["Bora", 38.77, -157.74, "CC,Sarna Commonality,Region 4"], ["Quemoy", 44.46, -151.5, "CC,Sarna Commonality,Region 4"], ["Sarmaxa", 53.23, -163.39, "CC,Sarna Commonality,Region 4"], ["Sarna", 55.01, -154.88, "CC,Sarna Commonality,Region 4,Major Capital"], ["Highspire", 100.29, -119.18, "CC,Sarna Commonality,Region 2"], ["Jonathan", 100.55, -93.11, "CC,Sarna Commonality,Region 2"], ["Mandate", 88.4, -126.22, "CC,Sarna Commonality,Region 5"], ["Matsu", 78.3, -136.23, "CC,Sarna Commonality,Region 5"], ["Menkib", 75.46, -128.99, "CC,Sarna Commonality,Region 5"], ["New Macao", 77.54, -122.35, "CC,Sarna Commonality,Region 5"], ["Zaurak", 72.72, -123.29, "CC,Sarna Commonality,Region 5"], ["Kaifeng", 71.85, -152.29, "CC,Sarna Commonality,Region 5"], ["Sakhalin (CC)", 61.77, -141.69, "CC,Sarna Commonality,Region 5"], ["Heligoland", 86.08, -145.05, "CC,Sarna Commonality,Region 7"], ["Remshield", 97.45, -139.9, "CC,Sarna Commonality,Region 7"], ["Truth", 78.32, -159.33, "CC,Sarna Commonality,Region 7"], ["Tsingtao", 93.31, -155.16, "CC,Sarna Commonality,Region 7"], ["Bentley", -6.98, -233.76, "CC,Sian Commonality,Region 1"], ["Calpaca", -20.17, -214.83, "CC,Sian Commonality,Region 1"], ["Krin", -7.77, -221.27, "CC,Sian Commonality,Region 1"], ["Pella II", -30.5, -227.02, "CC,Sian Commonality,Region 1"], ["Shuen Wan", -37.23, -219.29, "FWL"], ["Barras", 20.92, -354.18, "CC,Sian Commonality,Region 8"], ["Dicon", 20.14, -325.24, "CC,Sian Commonality,Region 8"], ["Grand Base", 46.0, -298.88, "CC,Sian Commonality,Region 8"], ["Kasdach", 20.93, -313.05, "CC,Sian Commonality,Region 8"], ["Nihal", 43.93, -310.77, "CC,Sian Commonality,Region 8"], ["Primus", 39.54, -320.09, "CC,Sian Commonality,Region 8"], ["Prix", 38.24, -328.31, "CC,Sian Commonality,Region 8"], ["Raphael", 45.23, -314.88, "CC,Sian Commonality,Region 8"], ["Holloway", 64.88, -301.46, "CC,Sian Commonality,Region 10"], ["Madras", 70.56, -325.24, "CC,Sian Commonality,Region 10"], ["Xieng Khouang", 85.29, -311.76, "CC,Sian Commonality,Region 10"], ["Menke", 90.73, -330.9, "CC,Sian Commonality,Region 11"], ["Frondas", -17.85, -247.74, "CC,Sian Commonality,Region 2"], ["Fronde", -5.96, -251.6, "CC,Sian Commonality,Region 2"], ["Cronulla", -33.09, -251.01, "FWL"], ["Goodna", -28.45, -240.2, "FWL"], ["Iknogoro", -50.16, -248.43, "FWL"], ["Kujari", -25.86, -265.08, "FWL"], ["Altorra", -2.85, -263.5, "CC,Sian Commonality,Region 2"], ["Palladaine", -3.11, -287.98, "CC,Sian Commonality,Region 2"], ["Westerhand", -5.44, -276.08, "CC,Sian Commonality,Region 2"], ["Scarborough", -15.53, -272.02, "FWL"], ["Castrovia", 13.69, -252.59, "CC,Sian Commonality,Region 3"], ["Claxton", 15.5, -264.19, "CC,Sian Commonality,Region 3"], ["Hexare", 31.02, -233.17, "CC,Sian Commonality,Region 3"], ["Imalda", 29.98, -240.2, "CC,Sian Commonality,Region 3"], ["Ito", 7.48, -275.58, "CC,Sian Commonality,Region 3"], ["Sian", 7.15, -229.66, "CC,Sian Commonality,Region 3,Faction Capital"], ["Decus", 44.45, -251.6, "CC,Sian Commonality,Region 4"], ["Harloc", 41.87, -224.44, "CC,Sian Commonality,Region 4"], ["Hustaing", 55.05, -245.66, "CC,Sian Commonality,Region 4"], ["New Westin", 38.25, -241.99, "CC,Sian Commonality,Region 4"], ["Purvo", 59.69, -258.83, "CC,Sian Commonality,Region 4"], ["Carmen", 28.43, -264.49, "CC,Sian Commonality,Region 5"], ["Homestead", 57.9, -283.62, "CC,Sian Commonality,Region 5"], ["Housekarle", 33.34, -276.88, "CC,Sian Commonality,Region 5"], ["Sendalor", 43.68, -266.87, "CC,Sian Commonality,Region 5"], ["Immenstadt", 82.18, -277.96, "FS,Capellan March,Taygeta Operational Area,Sirdar PDZ"], ["Manapire", 82.45, -292.93, "FS,Capellan March,Taygeta Operational Area,Sirdar PDZ"], ["Uravan", 75.83, -263.87, "FS,Capellan March,Taygeta Operational Area,Sirdar PDZ"], ["Velhas", 69.26, -278.66, "FS,Capellan March,Taygeta Operational Area,Sirdar PDZ"], ["Ziliang", 68.49, -264.19, "FS,Capellan March,Taygeta Operational Area,Sirdar PDZ"], ["Betelgeuse", 5.67, -306.9, "CC,Sian Commonality,Region 6"], ["Latice", 10.59, -293.73, "CC,Sian Commonality,Region 6"], ["Sigma Mare", 6.46, -314.94, "CC,Sian Commonality,Region 6"], ["Wright", 26.35, -290.85, "CC,Sian Commonality,Region 6"], ["Niomede", -0.27, -349.52, "CC,Sian Commonality,Region 7"], ["Principia", -0.02, -357.85, "CC,Sian Commonality,Region 7"], ["Shiba", 0.24, -331.19, "CC,Sian Commonality,Region 7"], ["Sadurni", -15.0, -344.37, "FWL,Duchy of Andurien"], ["Gurnet", 93.48, -231.09, "FS,Capellan March,Kathil Operational Area,Alcyone PDZ"], ["Kittery", 82.18, -223.94, "FS,Capellan March,Kathil Operational Area,Alcyone PDZ"], ["Scituate", 87.88, -219.99, "FS,Capellan March,Kathil Operational Area,Alcyone PDZ"], ["Denbar", 69.01, -235.25, "CC,St. Ives Commonality,Region 1"], ["Milos", 57.64, -225.24, "CC,St. Ives Commonality,Region 1"], ["Vestallas", 66.69, -214.83, "CC,St. Ives Commonality,Region 1"], ["Brighton", 79.09, -200.36, "CC,St. Ives Commonality,Region 2"], ["Armaxa", 106.48, -205.81, "CC,St. Ives Commonality,Region 2"], ["Nashuar", 97.58, -202.1, "CC,St. Ives Commonality,Region 2"], ["Taga", 88.92, -207.4, "CC,St. Ives Commonality,Region 2"], ["St. Ives", 109.62, -214.38, "CC,St. Ives Commonality,Region 2,Major Capital"], ["Indicass", 72.37, -249.03, "CC,St. Ives Commonality,Region 3"], ["Ambergrist", 83.48, -257.55, "CC,St. Ives Commonality,Region 3"], ["Maladar", 108.82, -247.74, "CC,St. Ives Commonality,Region 3"], ["St. Loris", 89.95, -241.99, "CC,St. Ives Commonality,Region 3"], ["Tantara", 101.31, -252.89, "CC,St. Ives Commonality,Region 3"], ["Tallin", 119.68, -267.06, "CC,St. Ives Commonality,Region 4"], ["Teng", 127.7, -272.02, "CC,St. Ives Commonality,Region 4"], ["Texlos", 110.63, -272.52, "CC,St. Ives Commonality,Region 4"], ["Warlock", 120.19, -257.75, "CC,St. Ives Commonality,Region 4"], ["Andarmax", -3.38, -386.49, "CC,Sian Commonality,Region 7"], ["Sax", -1.56, -374.6, "CC,Sian Commonality,Region 7"], ["Calseraigne", -8.28, -367.67, "FWL"], ["Pilpala", -23.53, -375.39, "FWL"], ["Drozan", 31.27, -369.94, "CC,Sian Commonality,Region 13"], ["Jacomarle", 12.91, -382.63, "CC,Sian Commonality,Region 13"], ["Turin", 21.19, -367.86, "CC,Sian Commonality,Region 13"], ["Gunthar", 39.28, -383.12, "CC,Sian Commonality,Region 13"], ["Bellatrix", 54.28, -351.61, "CC,Sian Commonality,Region 9"], ["Borden", 51.43, -370.73, "CC,Sian Commonality,Region 9"], ["Decatur", 54.15, -336.26, "CC,Sian Commonality,Region 9"], ["Kurvasa", 39.54, -351.61, "CC,Sian Commonality,Region 9"], ["Cavalor", 60.99, -387.78, "CC,Sian Commonality,Region 14"], ["Columbine", 74.95, -345.96, "CC,Sian Commonality,Region 14"], ["Egress", 67.97, -370.24, "CC,Sian Commonality,Region 14"], ["Pojos", 85.03, -377.18, "CC,Sian Commonality,Region 14"], ["Quimberton", 83.22, -359.4, "CC,Sian Commonality,Region 14"], ["Vard", 74.17, -354.98, "CC,Sian Commonality,Region 14"], ["Corodiz", 135.7, -374.9, "CC,Sian Commonality,Region 12"], ["Muridox", 106.49, -382.14, "CC,Sian Commonality,Region 12"], ["Zanzibar", 119.67, -364.79, "CC,Sian Commonality,Region 12"], ["Arn (Jia Tian 3130+)", -29.95, -419.97, "A"], ["Shaobuon (Liu's Memory 3130+)", -10.82, -416.35, "A"], ["Zhaomaon (Cluff's Stand 3130+)", 1.34, -428.93, "A"], ["New Roland", -8.02, -401.26, "CC,Sian Commonality,Region 15"], ["Joppa", -27.02, -437.8, "U"], ["Thamel (Wyeth's Glory 3130+)", 24.53, -415.05, "A"], ["Hurik", 77.79, -396.31, "CC,Sian Commonality,Region 15"], ["Renown", 41.6, -397.89, "CC,Sian Commonality,Region 15"], ["Repulse", 16.27, -397.1, "CC,Sian Commonality,Region 15"], ["Ward", 72.1, -408.2, "CC,Sian Commonality,Region 15"], ["Detroit", 19.15, -452.55, "I"], ["Larsha", 118.38, -393.23, "CC,Sian Commonality,Region 15"], ["Rollis", 150.44, -383.43, "CC,Sian Commonality,Region 15"], ["Bromhead", 159.74, -377.48, "FS,Capellan March,Taygeta Operational Area,Sirdar PDZ"], ["Brisbane", 154.95, -398.78, "TC,Hyades Union"], ["Laconis", 152.05, -392.97, "TC,Hyades Union"], ["Belle Isle", 445.27, -451.75, "U"], ["Carvajal", 417.12, -435.92, "U"], ["Diik", 531.01, -464.28, "U"], ["Gaul", 514.08, -487.59, "U"], ["Lastpost", 565.53, -444.16, "U"], ["Marknick", 498.69, -483.2, "U"], ["Mirfak", 386.12, -478.36, "U"], ["Oscar", 548.6, -451.75, "U"], ["Tyrrhenia", 428.56, -488.47, "U"], ["Albaracht", 492.56, -458.27, "U"], ["Franmalin", 415.69, -473.2, "U"], ["Fylovar", 461.35, -489.81, "U"], ["Erod's Escape", 483.63, -501.89, ""], ["Chaine Cluster (7)", -235.0, 568.8, "CI"], ["Lackhove", -166.22, 444.22, "MV"], ["Bruben", -5.7, 388.47, "DC,Rasalhague Military District,Kirchbach Prefecture"], ["Harvest", -62.05, 375.29, "DC,Rasalhague Military District,Kirchbach Prefecture"], ["Kirchbach", -39.05, 382.78, "DC,Rasalhague Military District,Kirchbach Prefecture,Minor Capital"], ["Liezen", -20.95, 380.2, "DC,Rasalhague Military District,Kirchbach Prefecture"], ["Lovinac", -29.21, 390.28, "DC,Rasalhague Military District,Kirchbach Prefecture"], ["New Caledonia", -59.2, 405.53, "DC,Rasalhague Military District,Kirchbach Prefecture"], ["Rodigo", -17.32, 393.38, "DC,Rasalhague Military District,Kirchbach Prefecture"], ["The Edge", -33.61, 407.08, "DC,Rasalhague Military District,Kirchbach Prefecture"], ["Verthandi", -54.82, 395.97, "DC,Rasalhague Military District,Kirchbach Prefecture"], ["Apollo (Terra Prime)", -129.64, 432.46, "LC,Tamar Pact,Trellshire"], ["Bensinger", -128.76, 444.56, "LC,Tamar Pact,Trellshire"], ["Derf", -130.84, 394.67, "LC,Tamar Pact,Trellshire"], ["Here", -150.17, 444.82, "LC,Tamar Pact,Trellshire"], ["Icar", -83.5, 413.8, "LC,Tamar Pact,Trellshire"], ["Persistence", -106.26, 406.31, "LC,Tamar Pact,Trellshire"], ["Steelton", -105.76, 422.33, "LC,Tamar Pact,Trellshire"], ["Toland", -115.77, 431.38, "LC,Tamar Pact,Trellshire"], ["Treeline (Winfield 2863+)", -111.71, 405.26, "LC,Tamar Pact,Trellshire"], ["Chateau", -75.75, 395.45, "LC,Tamar Pact,Trellshire"], ["Evciler", -95.14, 356.67, "LC,Tamar Pact,Trellshire"], ["Maxie's Planet", -96.43, 389.51, "LC,Tamar Pact,Trellshire"], ["Romulus", -89.7, 379.42, "LC,Tamar Pact,Trellshire"], ["Seiduts", -81.94, 361.59, "LC,Tamar Pact,Trellshire"], ["Trell I", -113.98, 386.94, "LC,Tamar Pact,Trellshire,Minor Capital"], ["Csesztreg", -69.29, 391.31, "DC,Rasalhague Military District,Kirchbach Prefecture"], ["Far Reach", -216.87, 567.7, "CI"], ["Fredotto", -171.59, 561.81, "CI"], ["Haublan", -200.6, 580.45, "CI"], ["Idrmach", -166.64, 584.49, "CI"], ["Ingvolstand", -153.3, 570.18, "CI"], ["Paran", -205.28, 548.71, "CI"], ["Rondane", -223.8, 583.82, "CI"], ["Syrstart", -185.24, 576.38, "CI"], ["Vannes", -167.47, 548.32, "CI"], ["Erewhon", -185.85, 445.86, "MV"], ["Deia", -176.05, 303.69, "LC,Protectorate of Donegal,Coventry Province"], ["Chahar", -198.53, 340.64, "LC,Protectorate of Donegal,Coventry Province"], ["Clermont", -209.94, 352.54, "LC,Protectorate of Donegal,Coventry Province"], ["Kolovraty", -241.16, 372.18, "LC,Protectorate of Donegal,Coventry Province"], ["Colmar", -66.18, 299.29, "LC,Tamar Pact,Tamar Domains"], ["Dompaire", -74.72, 300.07, "LC,Tamar Pact,Tamar Domains"], ["Antares", -124.89, 297.73, "LC,Tamar Pact,Tamar Domains"], ["Blair Atholl", -98.76, 271.12, "LC,Tamar Pact,Tamar Domains"], ["Graus", -100.62, 297.22, "LC,Tamar Pact,Tamar Domains"], ["Koniz", -92.55, 259.73, "LC,Tamar Pact,Tamar Domains"], ["Montmarault", -59.2, 263.09, "LC,Tamar Pact,Tamar Domains"], ["Benfled", -72.91, 260.77, "LC,Tamar Pact,Tamar Domains"], ["Anywhere", -167.21, 436.03, "LC,Tamar Pact,Trellshire"], ["Beta VII", -154.82, 384.33, "LC,Tamar Pact,Trellshire"], ["Bone-Norman", -185.36, 424.92, "LC,Tamar Pact,Trellshire"], ["Golandrinas", -159.48, 400.36, "LC,Tamar Pact,Trellshire"], ["Somerset", -159.48, 425.69, "LC,Tamar Pact,Trellshire"], ["Wotan", -142.14, 408.37, "LC,Tamar Pact,Trellshire"], ["Babaeski", -137.59, 307.82, "LC,Protectorate of Donegal,Coventry Province"], ["Barcelona", -204.78, 411.47, "LC,Protectorate of Donegal,Coventry Province"], ["Black Earth", -180.4, 393.64, "LC,Protectorate of Donegal,Coventry Province"], ["Blue Hole", -186.65, 348.66, "LC,Protectorate of Donegal,Coventry Province"], ["Goat Path", -154.34, 353.57, "LC,Protectorate of Donegal,Coventry Province"], ["Hot Springs", -170.58, 367.79, "LC,Protectorate of Donegal,Coventry Province"], ["Kikuyu", -203.69, 366.49, "LC,Protectorate of Donegal,Coventry Province"], ["Kooken's Pleasure Pit", -165.24, 345.82, "LC,Protectorate of Donegal,Coventry Province"], ["Mkuranga", -160.78, 317.38, "LC,Protectorate of Donegal,Coventry Province"], ["Mogyorod", -214.01, 377.1, "LC,Protectorate of Donegal,Coventry Province"], ["Newtown Square", -228.27, 393.12, "LC,Protectorate of Donegal,Coventry Province"], ["Parakoila", -132.33, 322.82, "LC,Protectorate of Donegal,Coventry Province"], ["Pasig", -165.23, 332.63, "LC,Protectorate of Donegal,Coventry Province"], ["Roadside", -185.06, 368.82, "LC,Protectorate of Donegal,Coventry Province"], ["Blackjack", -156.91, 364.43, "LC,Protectorate of Donegal,Coventry Province"], ["Alyina", -134.91, 340.91, "LC,Tamar Pact,Trellshire"], ["Apolakkia", -116.38, 340.39, "LC,Tamar Pact,Trellshire"], ["Baker 3", -104.47, 324.1, "LC,Tamar Pact,Trellshire"], ["Butler", -126.18, 375.28, "LC,Tamar Pact,Trellshire"], ["Denizli", -113.01, 347.37, "LC,Tamar Pact,Trellshire"], ["Devin", -110.63, 333.92, "LC,Tamar Pact,Trellshire"], ["Leskovik", -90.49, 333.15, "LC,Tamar Pact,Trellshire"], ["Malibu", -145.31, 377.87, "LC,Tamar Pact,Trellshire"], ["Waldorff", -131.83, 358.74, "LC,Tamar Pact,Trellshire"], ["Sudeten", -83.47, 292.08, "LC,Tamar Pact,Tamar Domains"], ["Tukayyid", -4.43, 210.42, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Itabaiana", 127.17, 307.56, "DC,Pesht Military District,Kagoshima Prefecture"], ["Trondheim (DC)", 72.64, 405.24, "DC,Rasalhague Military District,Trondheim Prefecture,Minor Capital"], ["Twycross", -108.35, 365.25, "LC,Tamar Pact,Trellshire"], ["Qualip (Kerensky's Vision 3130+)", -72.64, 189.27, "A"], ["Basiliano", -36.97, 341.43, "DC,Rasalhague Military District,Kirchbach Prefecture"], ["Hohenems", -18.36, 348.4, "DC,Rasalhague Military District,Kirchbach Prefecture"], ["Moritz", -32.32, 319.45, "DC,Rasalhague Military District,Radstadt Prefecture"], ["Skokie", -41.63, 322.56, "DC,Rasalhague Military District,Radstadt Prefecture"], ["Weingarten", -19.4, 300.33, "DC,Rasalhague Military District,Radstadt Prefecture"], ["Kandis", -6.48, 322.04, "DC,Rasalhague Military District,Radstadt Prefecture"], ["Kufstein", -11.13, 341.43, "DC,Rasalhague Military District,Radstadt Prefecture"], ["Memmingen", 6.45, 308.6, "DC,Rasalhague Military District,Radstadt Prefecture"], ["Feltre", -20.17, 362.1, "DC,Rasalhague Military District,Kirchbach Prefecture"], ["Mozirje", -38.79, 362.1, "DC,Rasalhague Military District,Kirchbach Prefecture"], ["Unzmarkt", -0.01, 364.94, "DC,Rasalhague Military District,Radstadt Prefecture"], ["Hyperion", -19.4, 277.06, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Thannhausen", -8.55, 292.05, "DC,Rasalhague Military District,Radstadt Prefecture"], ["Volders", -24.04, 291.79, "DC,Rasalhague Military District,Radstadt Prefecture"], ["Wheel", -30.51, 264.91, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Hainfeld", -13.45, 268.53, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Heiligendreuz", 3.35, 277.83, "DC,Rasalhague Military District,Radstadt Prefecture"], ["Karston", -10.35, 277.06, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Carse", -15.78, 239.06, "LC,Tamar Pact,Tamar Domains"], ["Galuzzo", -15.53, 250.95, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Jabuka", -28.45, 219.42, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Quarell", -30.5, 232.6, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Thun", -17.85, 259.73, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Arcturus", -78.07, 174.44, "LC,Protectorate of Donegal,District of Donegal"], ["Garrison", -103.19, 180.38, "LC,Protectorate of Donegal,District of Donegal"], ["Surcin", -91.25, 197.37, "LC,Protectorate of Donegal,District of Donegal"], ["Bessarabia", -25.61, 276.8, "LC,Tamar Pact,Tamar Domains"], ["Cusset", -49.38, 283.78, "LC,Tamar Pact,Tamar Domains"], ["Dell", -61.28, 330.82, "LC,Tamar Pact,Tamar Domains"], ["Kobe", -15.01, 281.45, "LC,Tamar Pact,Tamar Domains"], ["Laurent", -44.22, 302.91, "LC,Tamar Pact,Tamar Domains"], ["Maestu", -35.36, 288.91, "LC,Tamar Pact,Tamar Domains"], ["Sevren", -44.47, 313.25, "LC,Tamar Pact,Tamar Domains"], ["Svarstaad", -62.05, 338.58, "LC,Tamar Pact,Tamar Domains"], ["Vulcan", -66.71, 320.49, "LC,Tamar Pact,Tamar Domains"], ["Zoetermeer", -78.08, 330.57, "LC,Tamar Pact,Tamar Domains"], ["Biota", -44.74, 271.63, "LC,Tamar Pact,Tamar Domains"], ["Domain", -32.83, 248.12, "LC,Tamar Pact,Tamar Domains"], ["La Grave", -51.19, 247.07, "LC,Tamar Pact,Tamar Domains"], ["Perrot (Shaula 3025+)", -30.65, 269.79, "D"], ["Rastaban", -33.62, 262.84, "LC,Tamar Pact,Tamar Domains"], ["Suk II", -29.21, 256.12, "LC,Tamar Pact,Tamar Domains"], ["Blue Diamond", -41.62, 181.42, "LC,Tamar Pact,Tamar Domains"], ["Crimond", -68.52, 230.61, "LC,Tamar Pact,Tamar Domains"], ["Kelenfold", -57.39, 198.21, "LC,Tamar Pact,Tamar Domains"], ["Orkney (LC)", -48.6, 234.93, "LC,Tamar Pact,Tamar Domains"], ["Tomans", -50.93, 222.26, "LC,Tamar Pact,Tamar Domains"], ["Borghese", -79.28, 210.53, "LC,Tamar Pact,Tamar Domains"], ["Fatima", -31.29, 175.73, "LC,Tamar Pact,Tamar Domains"], ["Morningside", -35.68, 167.97, "LC,Tamar Pact,Tamar Domains"], ["Fort Loudon", -32.33, 209.08, "LC,Tamar Pact,Tamar Domains"], ["Meacham", -28.7, 187.36, "LC,Tamar Pact,Tamar Domains"], ["Rasalgethi", -41.88, 212.18, "LC,Tamar Pact,Tamar Domains"], ["Planting", -53.79, 364.69, "LC,Tamar Pact,Trellshire"], ["Tamar", -15.39, 314.86, "LC,Tamar Pact,Tamar Domains,Major Capital"], ["Huan", 304.75, 98.18, "DC,Galedon Military District,Kaznejoy Prefecture"], ["Elidere IV", 279.95, 75.96, "FS,Draconis March,Robinson Operational Area,Dahar PDZ"], ["Harrow's Sun", 261.85, 71.04, "FS,Draconis March,Robinson Operational Area,Raman PDZ"], ["Marlowe's Rift", 234.71, 87.84, "DC,Galedon Military District,Matsuida Prefecture"], ["Misery", 274.26, 84.99, "DC,Galedon Military District,Matsuida Prefecture"], ["New Aberdeen", 256.93, 78.28, "FS,Draconis March,Robinson Operational Area,Raman PDZ"], ["Thestria", 290.85, 79.92, "DC,Galedon Military District,Matsuida Prefecture"], ["Wapakoneta", 238.32, 69.23, "FS,Draconis March,Robinson Operational Area,Raman PDZ"], ["Cassias", 317.68, 79.83, "FS,Draconis March,Robinson Operational Area,Dahar PDZ"], ["Udibi", 316.13, 69.75, "FS,Draconis March,Robinson Operational Area,Dahar PDZ"], ["Great X", -184.36, 287.91, "LC,Protectorate of Donegal,Coventry Province"], ["Yeguas", -160.66, 281.75, "LC,Protectorate of Donegal,Coventry Province"], ["A Place", -123.76, 272.18, "LC,Tamar Pact,Tamar Domains"], ["Dustball", -104.48, 266.2, "LC,Tamar Pact,Tamar Domains"], ["Morges", -141.42, 283.2, "LC,Tamar Pact,Tamar Domains"], ["Aspropirgos", -119.14, -380.55, "FWL"], ["Butzfleth", -108.04, -373.81, "FWL"], ["Deschenes", -87.12, -297.59, "FWL"], ["Fagerholm", -81.95, -363.0, "FWL"], ["Furud", -25.34, -284.11, "FWL"], ["Gouderak", -116.87, -354.68, "FWL"], ["Granera", -98.24, -330.4, "FWL"], ["Piriapolis", -98.76, -358.35, "FWL"], ["Umka", -129.75, -361.42, "FWL"], ["Vakarel", -141.44, -351.91, "FWL"], ["Watermael", -118.45, -336.05, "FWL"], ["Antipolo", -94.87, -268.85, "FWL"], ["Kwamashu", -72.12, -260.13, "FWL"], ["Wallacia", -38.27, -267.85, "FWL"], ["Conquista", -9.58, -307.1, "FWL,Duchy of Andurien"], ["Cursa", -51.46, -348.63, "FWL,Duchy of Andurien"], ["Ingonish", -88.16, -344.07, "FWL,Duchy of Andurien"], ["Leyda", -71.09, -346.95, "FWL,Duchy of Andurien"], ["Lurgatan", -20.17, -330.9, "FWL,Duchy of Andurien"], ["Ryerson", -75.48, -321.58, "FWL,Duchy of Andurien"], ["Shiro III", -28.19, -292.64, "FWL,Duchy of Andurien"], ["Villanueva", -87.64, -348.53, "FWL,Duchy of Andurien"], ["Xanthe III", -67.22, -330.69, "FWL,Duchy of Andurien"], ["El Giza", -68.86, -274.0, "FWL,Mosiro Archipelago"], ["Mosiro", -65.14, -280.74, "FWL,Mosiro Archipelago"], ["Andurien", -41.34, -315.25, "FWL,Duchy of Andurien,Major Capital"], ["Aix-la-Chapelle", 76.6, 162.63, "DC,Benjamin Military District,Benjamin Prefecture"], ["Awano", 95.9, 160.99, "DC,Benjamin Military District,Benjamin Prefecture"], ["Cadiz (DC)", 122.0, 149.1, "DC,Benjamin Military District,Benjamin Prefecture"], ["Dover", 132.6, 201.31, "DC,Benjamin Military District,Benjamin Prefecture"], ["Dyfed", 126.14, 213.73, "DC,Benjamin Military District,Benjamin Prefecture"], ["Falsterbo (DC)", 170.86, 147.56, "DC,Benjamin Military District,Benjamin Prefecture"], ["Fukuroi", 110.63, 134.12, "DC,Benjamin Military District,Benjamin Prefecture"], ["Havdhem", 183.27, 185.55, "DC,Benjamin Military District,Benjamin Prefecture"], ["Helsingfors", 143.71, 152.72, "DC,Benjamin Military District,Benjamin Prefecture"], ["Kajikazawa", 88.41, 142.62, "DC,Benjamin Military District,Benjamin Prefecture"], ["Mersa Matruh", 130.86, 168.85, "DC,Benjamin Military District,Benjamin Prefecture"], ["Minakuchi", 63.84, 116.53, "DC,Benjamin Military District,Benjamin Prefecture"], ["Minowa", 183.52, 157.41, "DC,Benjamin Military District,Benjamin Prefecture"], ["Osmus Saar", 149.4, 173.92, "DC,Benjamin Military District,Benjamin Prefecture"], ["Paracale", 99.76, 215.57, "DC,Benjamin Military District,Benjamin Prefecture"], ["Peacock", 136.48, 184.0, "DC,Benjamin Military District,Benjamin Prefecture"], ["Saaremaa", 138.81, 136.95, "DC,Benjamin Military District,Benjamin Prefecture"], ["Sakai", 109.34, 205.97, "DC,Benjamin Military District,Benjamin Prefecture"], ["Shibukawa", 116.58, 183.23, "DC,Benjamin Military District,Benjamin Prefecture"], ["Silkeborg", 181.45, 185.81, "DC,Benjamin Military District,Benjamin Prefecture"], ["Sutama", 90.73, 123.77, "DC,Benjamin Military District,Benjamin Prefecture"], ["Tamsalu", 167.5, 164.51, "DC,Benjamin Military District,Benjamin Prefecture"], ["Tatsuno", 204.46, 155.05, "DC,Benjamin Military District,Benjamin Prefecture"], ["Tok Do", 94.82, 178.99, "DC,Benjamin Military District,Benjamin Prefecture"], ["Valmiera", 188.95, 132.04, "DC,Benjamin Military District,Benjamin Prefecture"], ["Vanern", 159.22, 141.09, "DC,Benjamin Military District,Benjamin Prefecture"], ["Yardley", 166.47, 209.85, "DC,Benjamin Military District,Benjamin Prefecture"], ["Benjamin", 123.98, 134.53, "DC,Benjamin Military District,Benjamin Prefecture,Major Capital"], ["Algedi", 66.07, 94.94, "DC,Dieron Military District,Algedi Prefecture,Minor Capital"], ["Caldrea", 33.85, 193.31, "DC,Benjamin Military District,Buckminster Prefecture"], ["Camlann (LC)", 0.52, 165.62, "DC,Benjamin Military District,Buckminster Prefecture"], ["Chandler", 47.04, 207.27, "DC,Benjamin Military District,Buckminster Prefecture"], ["Kiesen", 50.91, 216.31, "DC,Benjamin Military District,Buckminster Prefecture"], ["Najha", 35.67, 211.14, "DC,Benjamin Military District,Buckminster Prefecture"], ["Numki", 49.1, 201.06, "DC,Benjamin Military District,Buckminster Prefecture"], ["Pilkhua", 33.59, 206.23, "DC,Benjamin Military District,Buckminster Prefecture"], ["Shirotori", 18.08, 189.69, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Sulafat", 48.33, 184.26, "DC,Benjamin Military District,Buckminster Prefecture"], ["Trolloc Prime", 33.59, 171.08, "DC,Benjamin Military District,Buckminster Prefecture"], ["Arkab", 77.29, 200.8, "DC,Benjamin Military District,Buckminster Prefecture"], ["Babuyan", 87.88, 223.29, "DC,Benjamin Military District,Buckminster Prefecture"], ["Darius", 65.12, 204.68, "DC,Benjamin Military District,Buckminster Prefecture"], ["Dumaring", 79.61, 223.29, "DC,Benjamin Military District,Buckminster Prefecture"], ["Gram", 54.28, 144.45, "DC,Benjamin Military District,Buckminster Prefecture"], ["Kiamba", 71.07, 239.83, "DC,Benjamin Military District,Buckminster Prefecture"], ["Meilen", 59.96, 219.68, "DC,Benjamin Military District,Buckminster Prefecture"], ["Odabasi", 71.08, 213.73, "DC,Benjamin Military District,Buckminster Prefecture"], ["Ogano", 82.97, 211.14, "DC,Benjamin Military District,Buckminster Prefecture"], ["Otho", 78.42, 176.29, "DC,Benjamin Military District,Buckminster Prefecture"], ["Shimosuwa", 46.0, 135.41, "DC,Benjamin Military District,Buckminster Prefecture"], ["Baldur", 79.88, 188.11, "DC,Benjamin Military District,Buckminster Prefecture"], ["Aubisson", 4.39, 146.51, "DC,Dieron Military District,Vega Prefecture"], ["Shionoha", -5.7, 134.38, "DC,Dieron Military District,Vega Prefecture"], ["Buckminster", 17.58, 154.65, "DC,Benjamin Military District,Buckminster Prefecture,Minor Capital"], ["Annapolis", 164.65, 130.75, "DC,Benjamin Military District,Irurzun Prefecture"], ["Apriki", 173.19, 121.45, "DC,Benjamin Military District,Irurzun Prefecture"], ["Cussar (Barlow's Folly 2864+)", 173.19, 66.91, "DC,Benjamin Military District,Irurzun Prefecture"], ["Donenac", 200.33, 88.88, "DC,Benjamin Military District,Irurzun Prefecture"], ["Koping Chian", 181.2, 116.28, "DC,Benjamin Military District,Irurzun Prefecture"], ["Ljugarn", 198.0, 120.41, "DC,Benjamin Military District,Irurzun Prefecture"], ["Ludwig", 162.07, 76.98, "DC,Benjamin Military District,Irurzun Prefecture"], ["Monistrol", 159.48, 123.51, "DC,Benjamin Military District,Irurzun Prefecture"], ["New Mendham", 179.12, 59.4, "DC,Benjamin Military District,Irurzun Prefecture"], ["Paris", 191.79, 47.52, "DC,Benjamin Military District,Irurzun Prefecture"], ["Reisling's Planet", 175.77, 80.6, "DC,Benjamin Military District,Irurzun Prefecture"], ["Tripoli", 199.55, 52.94, "DC,Benjamin Military District,Irurzun Prefecture"], ["Breed", 195.41, 39.76, "FS,Draconis March,Robinson Operational Area,Raman PDZ"], ["Dobson", 204.2, 26.32, "FS,Draconis March,Robinson Operational Area,Raman PDZ"], ["Klathandu IV", 175.25, 31.49, "FS,Draconis March,Robinson Operational Area,Raman PDZ"], ["Irurzun", 187.05, 97.54, "DC,Benjamin Military District,Irurzun Prefecture,Minor Capital"], ["Hagiwawa", 123.55, 112.14, "DC,Benjamin Military District,Proserpina Prefecture"], ["Homam", 146.3, 51.91, "DC,Benjamin Military District,Proserpina Prefecture"], ["Junction", 134.93, 78.79, "DC,Benjamin Military District,Proserpina Prefecture"], ["Kitalpha", 112.95, 96.43, "DC,Benjamin Military District,Proserpina Prefecture"], ["Kurhah", 104.16, 56.37, "DC,Benjamin Military District,Proserpina Prefecture"], ["Lapida II", 112.95, 51.17, "DC,Benjamin Military District,Proserpina Prefecture"], ["Matar", 162.07, 56.3, "DC,Benjamin Military District,Proserpina Prefecture"], ["Tannil", 122.0, 57.34, "DC,Benjamin Military District,Proserpina Prefecture"], ["Umijiri", 123.81, 106.45, "DC,Benjamin Military District,Proserpina Prefecture"], ["Waddesdon", 99.13, 91.4, "DC,Benjamin Military District,Proserpina Prefecture"], ["Baruun Urt", 105.58, 237.73, "DC,Benjamin Military District,Xinyang Prefecture"], ["Bicester", 148.63, 227.95, "DC,Benjamin Military District,Xinyang Prefecture"], ["Braunton", 129.24, 237.24, "DC,Benjamin Military District,Xinyang Prefecture"], ["Corsica Nueva", 194.12, 227.17, "DC,Benjamin Military District,Xinyang Prefecture"], ["Iijima", 211.18, 196.15, "DC,Benjamin Military District,Xinyang Prefecture"], ["Kanowit", 87.2, 241.53, "DC,Benjamin Military District,Xinyang Prefecture"], ["Koumi", 199.29, 170.82, "DC,Benjamin Military District,Xinyang Prefecture"], ["Leiston", 174.48, 234.67, "DC,Benjamin Military District,Xinyang Prefecture"], ["Omagh", 152.76, 211.4, "DC,Benjamin Military District,Xinyang Prefecture"], ["Philadelphia", 191.54, 208.82, "DC,Benjamin Military District,Xinyang Prefecture"], ["Tanh Linh", 90.21, 232.34, "DC,Benjamin Military District,Xinyang Prefecture"], ["Yumesta", 169.82, 225.13, "DC,Benjamin Military District,Xinyang Prefecture"], ["Xinyang", 113.21, 224.94, "DC,Benjamin Military District,Xinyang Prefecture,Minor Capital"], ["Altdorf", 333.19, 119.37, "DC,Galedon Military District,Kaznejoy Prefecture"], ["Beta Mensae V", 317.16, 129.2, "DC,Galedon Military District,Kaznejoy Prefecture"], ["Budingen", 382.3, 162.03, "DC,Galedon Military District,Kaznejoy Prefecture"], ["Capra", 340.42, 105.71, "DC,Galedon Military District,Kaznejoy Prefecture"], ["Delacruz", 372.48, 113.17, "DC,Galedon Military District,Kaznejoy Prefecture"], ["Delitzsch", 326.46, 146.8, "DC,Galedon Military District,Kaznejoy Prefecture"], ["Groveld III", 386.96, 113.43, "FS,Draconis March,Woodbine Operational Area,Bryceland PDZ"], ["Niles (OA)", 398.59, 119.89, "FS,Draconis March,Woodbine Operational Area,Bryceland PDZ"], ["Schirmeck", 367.06, 156.59, "DC,Galedon Military District,Kaznejoy Prefecture"], ["Senorbi", 345.6, 149.87, "DC,Galedon Military District,Kaznejoy Prefecture"], ["Valentina", 397.81, 141.61, "DC,Galedon Military District,Kaznejoy Prefecture"], ["Waldheim", 345.85, 129.75, "DC,Galedon Military District,Kaznejoy Prefecture"], ["Weisau", 377.14, 134.12, "DC,Galedon Military District,Kaznejoy Prefecture"], ["Bremond", 388.25, 58.63, "FS,Draconis March,Woodbine Operational Area,Bremond PDZ"], ["Anguilla", 411.78, 79.28, "FS,Draconis March,Woodbine Operational Area,Bryceland PDZ"], ["Bryceland", 406.61, 97.92, "FS,Draconis March,Woodbine Operational Area,Bryceland PDZ"], ["Conroe", 377.14, 91.46, "FS,Draconis March,Woodbine Operational Area,Bryceland PDZ"], ["Kesai IV", 370.16, 105.68, "FS,Draconis March,Woodbine Operational Area,Bryceland PDZ"], ["Latexo", 392.91, 80.35, "FS,Draconis March,Woodbine Operational Area,Bryceland PDZ"], ["Lyceum", 428.57, 75.96, "FS,Draconis March,Woodbine Operational Area,Bryceland PDZ"], ["Sturgis", 416.94, 68.71, "FS,Draconis March,Woodbine Operational Area,Bryceland PDZ"], ["Tancredi IV", 429.61, 93.53, "FS,Draconis March,Woodbine Operational Area,Bryceland PDZ"], ["Kaznejoy", 329.46, 132.6, "DC,Galedon Military District,Kaznejoy Prefecture,Minor Capital"], ["Arlington", 212.74, 99.73, "DC,Galedon Military District,Matsuida Prefecture"], ["Gandy's Luck", 250.21, 93.01, "DC,Galedon Military District,Matsuida Prefecture"], ["Harpster", 213.25, 82.42, "FS,Draconis March,Robinson Operational Area,Raman PDZ"], ["Igualada", 290.27, 114.23, "DC,Galedon Military District,Matsuida Prefecture"], ["Kawabe", 240.65, 135.66, "DC,Galedon Military District,Matsuida Prefecture"], ["Kirei Na Niwa", 297.78, 147.3, "DC,Galedon Military District,Matsuida Prefecture"], ["Nadrin", 313.29, 152.72, "DC,Galedon Military District,Matsuida Prefecture"], ["Shaul Khala", 219.46, 133.33, "DC,Galedon Military District,Matsuida Prefecture"], ["Matsuida", 278.41, 129.1, "DC,Galedon Military District,Matsuida Prefecture,Minor Capital"], ["Ban Na San", 359.81, 220.7, "DC,Galedon Military District,New Samarkand Prefecture"], ["Chinmen Tao", 341.21, 215.54, "DC,Galedon Military District,New Samarkand Prefecture"], ["Chirala", 385.66, 240.87, "DC,Galedon Military District,New Samarkand Prefecture"], ["Cosenza", 325.96, 161.51, "DC,Galedon Military District,New Samarkand Prefecture"], ["Dnepropetrovsk", 299.33, 168.75, "DC,Galedon Military District,New Samarkand Prefecture"], ["Goubellat", 351.29, 165.13, "DC,Galedon Military District,New Samarkand Prefecture"], ["Keihoku", 307.7, 212.08, "DC,Galedon Military District,New Samarkand Prefecture"], ["Koulen", 371.7, 229.27, "DC,Galedon Military District,New Samarkand Prefecture"], ["Miyada", 310.18, 245.01, "DC,Galedon Military District,New Samarkand Prefecture"], ["Mizunami", 345.6, 232.08, "DC,Galedon Military District,New Samarkand Prefecture"], ["Nakaojo", 287.18, 183.23, "DC,Galedon Military District,New Samarkand Prefecture"], ["Sakuranoki", 282.27, 159.97, "DC,Galedon Military District,New Samarkand Prefecture"], ["Sanda", 322.63, 194.8, "DC,Galedon Military District,New Samarkand Prefecture"], ["Sighisoara", 302.44, 238.29, "DC,Galedon Military District,New Samarkand Prefecture"], ["Simferopol", 307.19, 188.34, "DC,Galedon Military District,New Samarkand Prefecture"], ["Sinope", 382.56, 195.37, "DC,Galedon Military District,New Samarkand Prefecture"], ["Sverdlovsk", 341.21, 184.26, "DC,Galedon Military District,New Samarkand Prefecture"], ["Tiflis", 354.13, 195.64, "DC,Galedon Military District,New Samarkand Prefecture"], ["Worrell", 292.87, 230.27, "DC,Galedon Military District,New Samarkand Prefecture"], ["Zalaf", 388.25, 212.18, "DC,Galedon Military District,New Samarkand Prefecture"], ["Bad News", 422.12, 195.37, "DC,Galedon Military District,Tabayama Prefecture"], ["New Samarkand", 359.45, 248.59, "DC,Galedon Military District,New Samarkand Prefecture,Minor Capital"], ["Agematsu", 253.84, 185.55, "DC,Galedon Military District,Oshika Prefecture"], ["Hachiman", 252.8, 152.2, "DC,Galedon Military District,Oshika Prefecture"], ["Handa", 274.77, 140.58, "DC,Galedon Military District,Oshika Prefecture"], ["Hun Ho", 250.21, 136.69, "DC,Galedon Military District,Oshika Prefecture"], ["Isesaki", 277.09, 193.85, "DC,Galedon Military District,Oshika Prefecture"], ["Midway", 247.63, 203.13, "DC,Galedon Military District,Oshika Prefecture"], ["Togura", 224.36, 153.5, "DC,Galedon Military District,Oshika Prefecture"], ["Oshika", 239.15, 176.68, "DC,Galedon Military District,Oshika Prefecture,Minor Capital"], ["Nykvarn", 123.3, 388.72, "DC,Rasalhague Military District,Trondheim Prefecture"], ["Garstedt", 126.14, 382.0, "DC,Rasalhague Military District,Trondheim Prefecture"], ["Almunge", 163.62, 397.0, "DC,Pesht Military District,Albiero Prefecture"], ["Brocchi's Cluster (40)", 160.69, 387.51, "DC,Pesht Military District,Albiero Prefecture"], ["Coudoux", 180.7, 382.75, "DC,Pesht Military District,Albiero Prefecture"], ["Hanover", 167.23, 364.2, "DC,Pesht Military District,Albiero Prefecture"], ["Kabah", 207.05, 369.59, "DC,Pesht Military District,Albiero Prefecture"], ["Luzerne", 124.32, 351.79, "DC,Pesht Military District,Albiero Prefecture"], ["Rockland", 149.92, 419.23, "DC,Pesht Military District,Albiero Prefecture"], ["Savinsville", 141.9, 356.19, "DC,Pesht Military District,Albiero Prefecture"], ["Schuyler", 122.26, 367.02, "DC,Pesht Military District,Albiero Prefecture"], ["Schwartz", 176.29, 426.72, "DC,Pesht Military District,Albiero Prefecture"], ["Turtle Bay", 152.75, 400.91, "DC,Pesht Military District,Albiero Prefecture"], ["Byesville", 132.6, 335.73, "DC,Pesht Military District,Kagoshima Prefecture"], ["Marshdale", 163.37, 330.05, "DC,Pesht Military District,Kagoshima Prefecture"], ["Wolcott", 147.08, 337.28, "DC,Pesht Military District,Kagoshima Prefecture"], ["Albiero", 150.45, 356.78, "DC,Pesht Military District,Albiero Prefecture,Minor Capital"], ["Ouagadougou (Silence 3130+)", 217.46, 413.62, "A"], ["Bangor", 176.54, 349.72, "DC,Pesht Military District,Bjarred Prefecture"], ["Chupadero", 227.99, 379.42, "DC,Pesht Military District,Bjarred Prefecture"], ["Echo", 287.43, 369.63, "DC,Pesht Military District,Bjarred Prefecture"], ["Jeanette", 222.03, 367.3, "DC,Pesht Military District,Bjarred Prefecture"], ["Jeronimo", 183.01, 340.64, "DC,Pesht Military District,Bjarred Prefecture"], ["Lonaconing", 257.97, 374.51, "DC,Pesht Military District,Bjarred Prefecture"], ["Matamoras", 252.53, 349.21, "DC,Pesht Military District,Bjarred Prefecture"], ["Sawyer", 250.47, 392.64, "DC,Pesht Military District,Bjarred Prefecture"], ["Stapelfeld", 218.16, 393.16, "DC,Pesht Military District,Bjarred Prefecture"], ["Virentofta", 199.04, 400.1, "DC,Pesht Military District,Bjarred Prefecture"], ["Bjarred", 243.39, 408.68, "DC,Pesht Military District,Bjarred Prefecture,Minor Capital"], ["Asgard", 126.65, 266.2, "DC,Pesht Military District,Kagoshima Prefecture"], ["Avon", 150.09, 250.8, "DC,Pesht Military District,Kagoshima Prefecture"], ["Caripare", 146.81, 291.27, "DC,Pesht Military District,Kagoshima Prefecture"], ["Cyrenaica", 156.56, 273.93, "DC,Pesht Military District,Kagoshima Prefecture"], ["Juazeiro", 162.58, 301.64, "DC,Pesht Military District,Kagoshima Prefecture"], ["Labrea", 138.8, 325.43, "DC,Pesht Military District,Kagoshima Prefecture"], ["Outer Volta", 155.34, 317.93, "DC,Pesht Military District,Kagoshima Prefecture"], ["Port Arthur", 131.57, 255.34, "DC,Pesht Military District,Kagoshima Prefecture"], ["Tarazed", 126.14, 251.47, "DC,Pesht Military District,Kagoshima Prefecture"], ["Teniente", 185.1, 307.82, "DC,Pesht Military District,Kagoshima Prefecture"], ["Yamarovka", 111.67, 274.47, "DC,Pesht Military District,Kagoshima Prefecture"], ["Irece", 179.37, 293.99, "DC,Pesht Military District,Kagoshima Prefecture,Minor Capital"], ["Charity", 315.1, 263.94, "DC,Pesht Military District,Kagoshima Prefecture"], ["Chatham", 180.94, 250.17, "DC,Pesht Military District,Kagoshima Prefecture"], ["Cheriton", 244.78, 328.53, "DC,Pesht Military District,Kagoshima Prefecture"], ["Clearfield", 263.65, 327.49, "DC,Pesht Military District,Kagoshima Prefecture"], ["Ebensburg", 237.28, 301.39, "DC,Pesht Military District,Kagoshima Prefecture"], ["Espakeh", 301.91, 341.68, "DC,Pesht Military District,Kagoshima Prefecture"], ["Hassi R'mel", 288.73, 278.86, "DC,Pesht Military District,Kagoshima Prefecture"], ["Herndon", 225.4, 332.38, "DC,Pesht Military District,Kagoshima Prefecture"], ["Hyner", 204.2, 327.99, "DC,Pesht Military District,Kagoshima Prefecture"], ["Kilmarnock", 172.66, 263.09, "DC,Pesht Military District,Kagoshima Prefecture"], ["Loysville", 291.82, 320.0, "DC,Pesht Military District,Kagoshima Prefecture"], ["Macksburg", 276.33, 341.68, "DC,Pesht Military District,Kagoshima Prefecture"], ["Maldonado", 212.22, 321.0, "DC,Pesht Military District,Kagoshima Prefecture"], ["McAlister", 226.6, 343.05, "DC,Pesht Military District,Kagoshima Prefecture"], ["Meinacos", 201.09, 295.18, "DC,Pesht Military District,Kagoshima Prefecture"], ["Monywa", 348.96, 265.68, "DC,Pesht Military District,Kagoshima Prefecture"], ["Shimonoseki", 212.48, 248.36, "DC,Pesht Military District,Kagoshima Prefecture"], ["Tuscarawas", 258.23, 308.43, "DC,Pesht Military District,Kagoshima Prefecture"], ["Unity", 224.63, 287.4, "DC,Pesht Military District,Kagoshima Prefecture"], ["Kagoshima", 201.11, 254.85, "DC,Pesht Military District,Kagoshima Prefecture,Minor Capital"], ["Luthien", 167.62, 250.49, "DC,Pesht Military District,Kagoshima Prefecture,Faction Capital"], ["Pesht", 206.14, 309.91, "DC,Pesht Military District,Kagoshima Prefecture,Major Capital"], ["Takata (New Start 3130+)", 366.2, 301.52, "A"], ["Abagnar", 380.23, 314.82, "DC,Pesht Military District,Ningxia Prefecture"], ["Abiy Adi", 349.47, 314.57, "DC,Pesht Military District,Ningxia Prefecture"], ["Hongor", 390.06, 314.28, "DC,Pesht Military District,Ningxia Prefecture"], ["Huaide", 376.88, 286.62, "DC,Pesht Military District,Ningxia Prefecture"], ["Land's End", 407.88, 320.0, "DC,Pesht Military District,Ningxia Prefecture"], ["Linqing", 341.73, 310.4, "DC,Pesht Military District,Ningxia Prefecture"], ["Sertar", 312.77, 292.3, "DC,Pesht Military District,Ningxia Prefecture"], ["Soul", 377.4, 279.12, "DC,Pesht Military District,Ningxia Prefecture"], ["Thimphu", 346.63, 286.37, "DC,Pesht Military District,Ningxia Prefecture"], ["Ningxia", 314.87, 313.34, "DC,Pesht Military District,Ningxia Prefecture,Minor Capital"], ["Ad Duwayd", 361.88, 374.51, "DC,Pesht Military District,Qandahar Prefecture"], ["Algate", 323.63, 378.13, "DC,Pesht Military District,Qandahar Prefecture"], ["Brailsford", 327.49, 385.14, "DC,Pesht Military District,Qandahar Prefecture"], ["Brihuega", 354.9, 391.08, "DC,Pesht Military District,Qandahar Prefecture"], ["Chapineria", 292.09, 392.08, "DC,Pesht Military District,Qandahar Prefecture"], ["Chorley", 332.93, 379.68, "DC,Pesht Military District,Qandahar Prefecture"], ["Hartshill", 323.63, 407.59, "DC,Pesht Military District,Qandahar Prefecture"], ["Kamarod", 346.37, 360.33, "DC,Pesht Military District,Qandahar Prefecture"], ["Korramabad", 372.73, 364.46, "DC,Pesht Military District,Qandahar Prefecture"], ["Leyland", 308.63, 392.9, "DC,Pesht Military District,Qandahar Prefecture"], ["Multan", 363.7, 329.02, "DC,Pesht Military District,Qandahar Prefecture"], ["Pusht-i-rud", 372.72, 348.64, "DC,Pesht Military District,Qandahar Prefecture"], ["Salford", 339.4, 403.2, "DC,Pesht Military District,Qandahar Prefecture"], ["Slaithwaite", 325.96, 393.12, "DC,Pesht Military District,Qandahar Prefecture"], ["Qandahar", 317.97, 358.12, "DC,Pesht Military District,Qandahar Prefecture,Minor Capital"], ["Simpson Desert", -271.59, -99.31, "FWL"], ["Atzenbrugg", -377.64, -176.57, "FWL"], ["Conakry", -316.19, -131.67, "FWL"], ["Curaumilla", -330.36, -119.18, "FWL"], ["Kilarney", -313.61, -116.41, "FWL"], ["Kogl", -354.95, -176.57, "FWL"], ["Lepaterique", -375.07, -166.56, "FWL"], ["Loongana", -294.68, -109.37, "FWL"], ["Maderas", -347.37, -113.3, "FWL"], ["Schiedam", -328.78, -145.35, "FWL"], ["Tormentine", -380.52, -158.53, "FWL"], ["Labouchere", -253.35, -74.49, "FWL"], ["Alorton", -353.65, -85.87, "FWL"], ["Edmondson", -338.69, -102.93, "FWL"], ["Niihau", -237.59, -79.93, "FWL"], ["Preston (FWL)", -223.91, -71.13, "FWL"], ["Schererville", -339.39, -87.41, "FWL"], ["Zortman", -212.71, -77.34, "FWL"], ["Hammer", -369.91, -142.77, "FWL,Abbey District"], ["Manotick", -372.49, -133.95, "FWL,Abbey District"], ["Maxwell", -376.94, -114.53, "FWL,Abbey District"], ["Silver", -339.19, -130.88, "FWL,Abbey District"], ["Gibraltar", -359.6, -139.9, "FWL,Abbey District"], ["Kosciusko", -302.71, -91.03, "FWL,Duchy of Tamarind"], ["Millungera", -282.59, -72.16, "FWL,Duchy of Tamarind"], ["Saltillo", -310.74, -82.51, "FWL,Duchy of Tamarind"], ["Tamarind", -268.94, -83.29, "FWL,Duchy of Tamarind,Minor Capital"], ["Elissa", -39.05, 483.08, "EF"], ["Manaringaine", -30.43, 518.04, "EF"], ["Nyserta", -17.78, 498.77, "EF"], ["Ferris (OC)", -55.39, 506.36, "OC"], ["Huanghuadian (Tincalunas 3130+)", 42.35, -432.17, "A"], ["Herotitus", 58.73, -430.11, "I"], ["Portland", 91.27, -508.6, "I"], ["Rockwellawan", 67.08, -483.32, "I"], ["Spencer", 5.52, -489.48, "I"], ["Appian", 44.14, -466.75, "U"], ["Cygnus", -7.08, -500.14, "U"], ["Independence", 58.66, -505.06, "U"], ["Mandalas", 66.74, -443.82, "U"], ["McEvans' Sacrifice", 42.47, -520.24, "U"], ["Fronc", -1.12, -517.35, "U"], ["Alcyone", 129.76, -197.58, "FS,Capellan March,Kathil Operational Area,Alcyone PDZ"], ["Cammal", 111.4, -164.98, "FS,Capellan March,Kathil Operational Area,Alcyone PDZ"], ["Daniels", 124.59, -196.5, "FS,Capellan March,Kathil Operational Area,Alcyone PDZ"], ["Lee", 116.83, -148.13, "FS,Capellan March,Kathil Operational Area,Alcyone PDZ"], ["Monhegan", 116.05, -184.1, "FS,Capellan March,Kathil Operational Area,Alcyone PDZ"], ["Stein's Folly", 159.74, -200.36, "FS,Capellan March,Kathil Operational Area,Alcyone PDZ"], ["Andro", 144.75, -173.0, "FS,Capellan March,Kathil Operational Area,Kathil PDZ"], ["Bethel", 140.62, -184.11, "FS,Capellan March,Kathil Operational Area,Kathil PDZ"], ["Tecumseh", 139.32, -105.01, "FS,Capellan March,Kathil Operational Area,Kathil PDZ"], ["Acala", 134.16, -124.34, "FS,Capellan March,Kathil Operational Area,Valexa PDZ"], ["Ashkum", 111.92, -101.15, "FS,Capellan March,Kathil Operational Area,Valexa PDZ"], ["Axton", 127.17, -113.24, "FS,Capellan March,Kathil Operational Area,Valexa PDZ"], ["Bell (CC)", 104.16, -109.87, "FS,Capellan March,Kathil Operational Area,Valexa PDZ"], ["Gallitzin", 131.57, -163.39, "FS,Capellan March,Kathil Operational Area,Valexa PDZ"], ["Moravian", 109.08, -132.37, "FS,Capellan March,Kathil Operational Area,Valexa PDZ"], ["Orbisonia", 150.17, -155.16, "FS,Capellan March,Kathil Operational Area,Valexa PDZ"], ["Perkasie", 130.79, -143.76, "FS,Capellan March,Kathil Operational Area,Valexa PDZ"], ["Beten Kaitos", 167.16, -112.91, "FS,Capellan March,Kathil Operational Area,Kathil PDZ"], ["Emerson", 171.57, -115.57, "FS,Capellan March,Kathil Operational Area,Kathil PDZ"], ["Monongahela", 164.91, -165.77, "FS,Capellan March,Kathil Operational Area,Kathil PDZ"], ["Novaya Zemlya", 180.68, -183.31, "FS,Capellan March,Kathil Operational Area,Kathil PDZ"], ["Smolensk", 178.35, -129.79, "FS,Capellan March,Kathil Operational Area,Kathil PDZ"], ["Salem", 206.79, -161.11, "FS,Crucis March,Markesan Operational Area,New Avalon Combat Region"], ["Talcott", 199.81, -123.84, "FS,Crucis March,Markesan Operational Area,New Avalon Combat Region"], ["Kathil", 171.36, -148.58, "FS,Capellan March,Kathil Operational Area,Kathil PDZ,Minor Capital"], ["Atlas", 157.42, -244.07, "FS,Capellan March,Kathil Operational Area,Alcyone PDZ"], ["Beid", 124.59, -243.77, "FS,Capellan March,Kathil Operational Area,Alcyone PDZ"], ["Corella", 142.17, -251.3, "FS,Capellan March,Kathil Operational Area,Alcyone PDZ"], ["Haappajarvi", 137.24, -240.7, "FS,Capellan March,Kathil Operational Area,Alcyone PDZ"], ["Mentasta", 114.25, -237.33, "FS,Capellan March,Kathil Operational Area,Alcyone PDZ"], ["Quittacas", 157.94, -219.79, "FS,Capellan March,Kathil Operational Area,Alcyone PDZ"], ["Redfield", 140.09, -212.75, "FS,Capellan March,Kathil Operational Area,Alcyone PDZ"], ["Royalston", 136.72, -224.14, "FS,Capellan March,Kathil Operational Area,Alcyone PDZ"], ["Shoreham", 123.8, -217.7, "FS,Capellan March,Kathil Operational Area,Alcyone PDZ"], ["Spica", 92.54, -237.63, "D"], ["Weekapaug", 107.79, -225.44, "FS,Capellan March,Kathil Operational Area,Alcyone PDZ"], ["Hadnall", 136.73, -262.7, "FS,Capellan March,Taygeta Operational Area,Sirdar PDZ"], ["Demeter", 91.5, -69.59, "FS,Capellan March,Kathil Operational Area,Valexa PDZ"], ["Almach", 100.8, -61.57, "FS,Capellan March,Kathil Operational Area,Valexa PDZ"], ["Chesterton", 115.62, -71.04, "FS,Capellan March,Kathil Operational Area,Valexa PDZ"], ["Goshen", 134.67, -94.65, "FS,Capellan March,Kathil Operational Area,Valexa PDZ"], ["Mesartim", 102.88, -54.59, "FS,Capellan March,Kathil Operational Area,Valexa PDZ"], ["Mira", 103.39, -52.0, "FS,Capellan March,Kathil Operational Area,Valexa PDZ"], ["Sonnia", 123.55, -41.93, "FS,Capellan March,Kathil Operational Area,Valexa PDZ"], ["Ulan Batar", 126.57, -74.41, "FS,Capellan March,Kathil Operational Area,Valexa PDZ"], ["Valexa", 113.81, -86.81, "FS,Capellan March,Kathil Operational Area,Valexa PDZ"], ["New Hessen", 84.01, -57.12, "CC,Tikonov Commonality,Region 7"], ["Aucara", 176.54, -296.3, "FS,Capellan March,Taygeta Operational Area,Altair PDZ"], ["Avigait", 153.02, -275.09, "FS,Capellan March,Taygeta Operational Area,Altair PDZ"], ["Beenleigh", 183.78, -268.85, "FS,Capellan March,Taygeta Operational Area,Altair PDZ"], ["Carmichael", 199.55, -349.03, "FS,Capellan March,Taygeta Operational Area,Altair PDZ"], ["Diefenbaker", 198.26, -341.5, "FS,Capellan March,Taygeta Operational Area,Altair PDZ"], ["Flintoft", 191.54, -333.27, "FS,Capellan March,Taygeta Operational Area,Altair PDZ"], ["Jaipur", 175.51, -280.25, "FS,Capellan March,Taygeta Operational Area,Altair PDZ"], ["Mandaree", 182.48, -308.99, "FS,Capellan March,Taygeta Operational Area,Altair PDZ"], ["Narellan", 170.6, -253.88, "FS,Capellan March,Taygeta Operational Area,Altair PDZ"], ["Robsart", 170.86, -340.21, "FS,Capellan March,Taygeta Operational Area,New Syrtis PDZ"], ["Wrentham", 170.6, -325.54, "FS,Capellan March,Taygeta Operational Area,New Syrtis PDZ"], ["Taygeta", 198.38, -295.67, "FS,Capellan March,Taygeta Operational Area,Altair PDZ,Minor Capital"], ["Kluane", 196.19, -199.37, "FS,Capellan March,Kathil Operational Area,Kathil PDZ"], ["Wappingers", 175.25, -231.19, "FS,Capellan March,Kathil Operational Area,Kathil PDZ"], ["Carmacks", 183.78, -236.83, "FS,Capellan March,Taygeta Operational Area,New Syrtis PDZ"], ["Fortymile", 193.6, -214.33, "FS,Capellan March,Taygeta Operational Area,New Syrtis PDZ"], ["Kigamboni", 206.27, -248.43, "FS,Capellan March,Taygeta Operational Area,New Syrtis PDZ"], ["Ogilvie", 195.76, -232.05, "FS,Capellan March,Taygeta Operational Area,New Syrtis PDZ"], ["Sekulmun", 212.22, -220.28, "FS,Capellan March,Taygeta Operational Area,New Syrtis PDZ"], ["Meglan (Victoria 2537+)", 225.66, -176.87, "FS,Crucis March,Markesan Operational Area,New Avalon Combat Region"], ["Birqash", 275.8, -266.27, "FS,Capellan March,Taygeta Operational Area,New Syrtis PDZ"], ["Cumberland", 207.04, -264.98, "FS,Capellan March,Taygeta Operational Area,New Syrtis PDZ"], ["Hobbs", 255.39, -244.07, "FS,Capellan March,Taygeta Operational Area,New Syrtis PDZ"], ["Hobson", 214.19, -283.98, "FS,Capellan March,Taygeta Operational Area,New Syrtis PDZ"], ["Kaitangata", 231.61, -279.75, "FS,Capellan March,Taygeta Operational Area,New Syrtis PDZ"], ["Mordialloc", 219.97, -263.5, "FS,Capellan March,Taygeta Operational Area,New Syrtis PDZ"], ["Okains", 241.17, -268.65, "FS,Capellan March,Taygeta Operational Area,New Syrtis PDZ"], ["Oltepesi", 252.54, -276.68, "FS,Capellan March,Taygeta Operational Area,New Syrtis PDZ"], ["Wernke", 248.41, -230.89, "FS,Capellan March,Taygeta Operational Area,New Syrtis PDZ"], ["New Syrtis", 231.06, -296.9, "FS,Capellan March,Taygeta Operational Area,New Syrtis PDZ,Major Capital"], ["Jacson", 110.62, -346.45, "CC,Sian Commonality,Region 11"], ["Victoria", 92.88, -347.98, "CC,Sian Commonality,Region 11"], ["Yuris", 134.66, -350.51, "CC,Sian Commonality,Region 12"], ["Abruzzi", 149.39, -304.33, "FS,Capellan March,Taygeta Operational Area,Sirdar PDZ"], ["Ashley", 164.39, -308.39, "FS,Capellan March,Taygeta Operational Area,Sirdar PDZ"], ["Bacum", 157.15, -289.26, "FS,Capellan March,Taygeta Operational Area,Sirdar PDZ"], ["Cotocallao", 144.75, -299.67, "FS,Capellan March,Taygeta Operational Area,Sirdar PDZ"], ["Courcellete", 141.65, -310.77, "FS,Capellan March,Taygeta Operational Area,Sirdar PDZ"], ["Frazer", 129.23, -333.47, "FS,Capellan March,Taygeta Operational Area,Sirdar PDZ"], ["Glentworth", 125.88, -317.71, "FS,Capellan March,Taygeta Operational Area,Sirdar PDZ"], ["Horsham", 155.35, -354.98, "FS,Capellan March,Taygeta Operational Area,Sirdar PDZ"], ["Ikast", 101.31, -284.11, "FS,Capellan March,Taygeta Operational Area,Sirdar PDZ"], ["Jonzac", 115.28, -297.59, "FS,Capellan March,Taygeta Operational Area,Sirdar PDZ"], ["Kafr Silim", 118.64, -287.97, "FS,Capellan March,Taygeta Operational Area,Sirdar PDZ"], ["Mendham", 147.85, -344.87, "FS,Capellan March,Taygeta Operational Area,Sirdar PDZ"], ["Safe Port", 134.42, -286.99, "FS,Capellan March,Taygeta Operational Area,Sirdar PDZ"], ["Shaunavon", 160.26, -323.46, "FS,Capellan March,Taygeta Operational Area,Sirdar PDZ"], ["Sirdar", 127.16, -309.48, "FS,Capellan March,Taygeta Operational Area,Sirdar PDZ"], ["Weatogue", 98.74, -276.68, "FS,Capellan March,Taygeta Operational Area,Sirdar PDZ"], ["Alsek", 315.62, -238.12, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["Antietam", 330.86, -137.03, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["Bastian", 297.26, -160.02, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["Chakachamna", 299.85, -181.23, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["Colorado", 344.57, -199.07, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["Fincastle", 323.11, -163.19, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["Grosvenor", 285.88, -224.64, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["Gulkana", 353.61, -177.86, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["Ingenstrem", 317.16, -225.44, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["Kaguyak", 297.25, -236.04, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["Kaiyuh", 362.4, -217.71, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["Kotzebue", 316.65, -205.81, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["Nahoni", 245.82, -198.58, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["New Damascus", 274.0, -206.6, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["Nizina", 309.67, -228.31, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["Noatak", 330.86, -213.84, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["Notwina", 294.93, -193.92, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["Nunivak", 322.07, -188.26, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["Reisterstown", 315.61, -149.21, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["Semichi", 299.59, -214.83, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["Sparrevohn", 343.79, -188.27, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["Susulatna", 305.01, -185.69, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["Tatlawiksuk", 371.45, -190.35, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["Waxell", 279.42, -179.94, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["Montcoal", 247.89, -168.35, "FS,Crucis March,Markesan Operational Area,New Avalon Combat Region"], ["Remagen", 275.8, -156.15, "FS,Crucis March,Markesan Operational Area,New Avalon Combat Region"], ["Chirikof", 335.8, -233.46, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region,Minor Capital"], ["Bellevue", 328.03, -57.68, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Bogard", 269.34, -32.36, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Cahokia", 288.73, -72.95, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Capac", 310.18, -56.39, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Colchester", 305.27, -13.49, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Delphos", 319.75, -52.0, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["DeWitt", 257.72, -21.76, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Euclid", 349.47, -70.61, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Evansville", 293.64, -36.23, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Huron", 315.1, -71.91, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Imbrial III", 294.16, -49.42, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Kestrel", 268.31, -46.83, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Kirklin", 278.38, -67.51, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Larned", 294.42, -23.05, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Lexington", 315.61, -22.79, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Macomb", 341.47, -20.21, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Necedah", 353.88, -8.06, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Newton", 317.41, -30.54, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Northfield", 279.42, -75.53, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["O'Fallon", 313.55, -83.29, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Parma", 359.81, -52.26, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Pattonsbrug", 377.14, -6.0, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Peabody", 330.6, -23.57, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Petrolia", 308.12, -70.36, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Plymouth", 344.04, -68.8, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Potwin", 307.6, -19.95, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Quincy", 347.41, -33.9, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Ramona", 329.06, -38.31, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Saunemin", 246.08, -56.39, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Sodus", 287.18, -65.19, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Streator", 254.1, -75.78, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Willowick", 328.28, -74.49, "FS,Crucis March,Markesan Operational Area,Kestrel Combat Region"], ["Avawatz", 164.91, -29.51, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["Barstow", 170.6, -40.89, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["Edwards", 132.09, -32.36, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["Farwell", 140.62, -79.67, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["Goderich", 144.5, -49.42, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["Johnsondale", 160.78, -23.05, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["Listowel", 150.17, -67.52, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["Logandale", 143.2, -35.98, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["Marlette", 154.58, -44.51, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["Rosamond", 178.61, -33.65, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["Sanilac", 147.34, -58.98, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["Tawas", 135.7, -55.88, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["Wroxeter", 166.47, -58.98, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["Amiga", 165.17, -84.57, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["Batavia", 201.1, -55.36, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["Beecher", 183.78, -50.2, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["Blandinsville", 227.99, -32.87, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["Bristol", 179.1, -65.98, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["Cholame", 202.4, -31.33, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["Corydon", 216.61, -38.82, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["Flushing", 195.41, -64.67, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["Layover", 204.2, -19.95, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["Manteno", 189.22, -71.91, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["McHenry", 179.39, -84.57, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["Muskegon", 164.54, -99.25, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["New Valencia", 219.97, -50.02, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["Scudder", 196.19, -95.95, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["Tiskilwa", 213.77, -90.26, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region"], ["Markesan", 221.52, -74.88, "FS,Crucis March,Markesan Operational Area,Achernar Combat Region,Minor Capital"], ["Argyle", 255.38, -109.17, "FS,Crucis March,Markesan Operational Area,New Avalon Combat Region"], ["Augusta", 282.27, -99.05, "FS,Crucis March,Markesan Operational Area,New Avalon Combat Region"], ["Belladonna", 262.88, -124.64, "FS,Crucis March,Markesan Operational Area,New Avalon Combat Region"], ["Chebanse", 225.15, -102.93, "FS,Crucis March,Markesan Operational Area,New Avalon Combat Region"], ["Coloma", 283.38, -87.36, "FS,Crucis March,Markesan Operational Area,New Avalon Combat Region"], ["Delavan", 269.86, -95.17, "FS,Crucis March,Markesan Operational Area,New Avalon Combat Region"], ["El Dorado", 266.5, -145.05, "FS,Crucis March,Markesan Operational Area,New Avalon Combat Region"], ["Freisland", 234.97, -118.69, "FS,Crucis March,Markesan Operational Area,New Avalon Combat Region"], ["Ipava", 259.0, -105.8, "FS,Crucis March,Markesan Operational Area,New Avalon Combat Region"], ["Leamington", 353.61, -91.04, "FS,Crucis March,Markesan Operational Area,New Avalon Combat Region"], ["Leipsic", 307.86, -103.92, "FS,Crucis March,Markesan Operational Area,New Avalon Combat Region"], ["Manassas", 315.36, -122.35, "FS,Crucis March,Markesan Operational Area,New Avalon Combat Region"], ["Numenor", 283.82, -107.59, "FS,Crucis March,Markesan Operational Area,New Avalon Combat Region"], ["Odell", 250.48, -97.5, "FS,Crucis March,Markesan Operational Area,New Avalon Combat Region"], ["Paulding", 305.0, -101.14, "FS,Crucis March,Markesan Operational Area,New Avalon Combat Region"], ["Saginaw", 299.59, -95.69, "FS,Crucis March,Markesan Operational Area,New Avalon Combat Region"], ["Steeles", 291.56, -141.98, "FS,Crucis March,Markesan Operational Area,New Avalon Combat Region"], ["Strawn", 236.0, -90.52, "FS,Crucis March,Markesan Operational Area,New Avalon Combat Region"], ["Torrence", 289.51, -130.88, "FS,Crucis March,Markesan Operational Area,New Avalon Combat Region"], ["New Avalon", 266.5, -110.84, "FS,Crucis March,Markesan Operational Area,New Avalon Combat Region,Faction Capital"], ["Agmond (Bornal 3130+)", 395.84, -140.36, "A"], ["Andalusia", 391.34, -109.17, "FS,Crucis March,Minette Operational Area,Point Barrow Combat Region"], ["Baxley", 432.2, -150.01, "FS,Crucis March,Minette Operational Area,Point Barrow Combat Region"], ["Bluford", 447.44, -80.18, "FS,Crucis March,Minette Operational Area,Point Barrow Combat Region"], ["Bonneau", 396.27, -165.97, "FS,Crucis March,Minette Operational Area,Point Barrow Combat Region"], ["Covington", 360.34, -149.71, "FS,Crucis March,Minette Operational Area,Point Barrow Combat Region"], ["Defiance", 424.95, -106.59, "FS,Crucis March,Minette Operational Area,Point Barrow Combat Region"], ["Dothan", 433.74, -134.25, "FS,Crucis March,Minette Operational Area,Point Barrow Combat Region"], ["Kettering", 446.67, -97.52, "FS,Crucis March,Minette Operational Area,Point Barrow Combat Region"], ["Meinrad", 392.65, -85.09, "FS,Crucis March,Minette Operational Area,Point Barrow Combat Region"], ["Molino", 460.36, -134.74, "FS,Crucis March,Minette Operational Area,Point Barrow Combat Region"], ["Perdido", 446.67, -113.24, "FS,Crucis March,Minette Operational Area,Point Barrow Combat Region"], ["Point Barrow", 362.92, -129.79, "FS,Crucis March,Minette Operational Area,Point Barrow Combat Region"], ["Shubuta", 459.84, -123.34, "FS,Crucis March,Minette Operational Area,Point Barrow Combat Region"], ["Sylvester", 363.43, -114.53, "FS,Crucis March,Minette Operational Area,Point Barrow Combat Region"], ["Wedgefield", 371.45, -162.6, "FS,Crucis March,Minette Operational Area,Point Barrow Combat Region"], ["Weldon", 429.6, -92.85, "FS,Crucis March,Minette Operational Area,Point Barrow Combat Region"], ["Xenia", 457.53, -88.97, "FS,Crucis March,Minette Operational Area,Point Barrow Combat Region"], ["Minette", 471.61, -109.7, "FS,Crucis March,Minette Operational Area,Point Barrow Combat Region,Minor Capital"], ["Cerulean", 412.81, -80.7, "FS,Crucis March,Minette Operational Area,Tsamma Combat Region"], ["Davisville", 481.31, -27.44, "FS,Crucis March,Minette Operational Area,Tsamma Combat Region"], ["Gambier", 381.79, -60.02, "FS,Crucis March,Minette Operational Area,Tsamma Combat Region"], ["Keytesville", 375.07, -30.81, "FS,Crucis March,Minette Operational Area,Tsamma Combat Region"], ["Mansfield", 394.7, -62.6, "FS,Crucis March,Minette Operational Area,Tsamma Combat Region"], ["Mauckport", 427.02, -53.29, "FS,Crucis March,Minette Operational Area,Tsamma Combat Region"], ["Mokane", 427.02, -23.05, "FS,Crucis March,Minette Operational Area,Tsamma Combat Region"], ["Monroe", 403.25, -44.77, "FS,Crucis March,Minette Operational Area,Tsamma Combat Region"], ["Palmyra", 450.8, -25.89, "FS,Crucis March,Minette Operational Area,Tsamma Combat Region"], ["Rosiclare", 478.98, -47.36, "FS,Crucis March,Minette Operational Area,Tsamma Combat Region"], ["St. Robert", 433.49, -31.33, "FS,Crucis March,Minette Operational Area,Tsamma Combat Region"], ["Sullivan", 413.07, -31.07, "FS,Crucis March,Minette Operational Area,Tsamma Combat Region"], ["Tsamma", 447.96, -44.77, "FS,Crucis March,Minette Operational Area,Tsamma Combat Region"], ["Ulysses", 413.33, -17.62, "FS,Crucis March,Minette Operational Area,Tsamma Combat Region"], ["Vicente", 449.0, -69.84, "FS,Crucis March,Minette Operational Area,Tsamma Combat Region"], ["Barlow's End", 304.5, 63.03, "FS,Draconis March,Robinson Operational Area,Dahar PDZ"], ["Bettendorf", 264.95, 25.8, "FS,Draconis March,Robinson Operational Area,Dahar PDZ"], ["Choudrant", 336.04, 56.04, "FS,Draconis March,Robinson Operational Area,Dahar PDZ"], ["Cimeron", 362.65, 83.97, "FS,Draconis March,Robinson Operational Area,Dahar PDZ"], ["Dahar IV", 279.42, 20.11, "FS,Draconis March,Robinson Operational Area,Dahar PDZ"], ["Damevang", 345.59, 64.32, "FS,Draconis March,Robinson Operational Area,Dahar PDZ"], ["Fairfield", 288.96, 45.7, "FS,Draconis March,Robinson Operational Area,Dahar PDZ"], ["Glenmora", 285.37, 52.94, "FS,Draconis March,Robinson Operational Area,Dahar PDZ"], ["Hoff", 264.18, 36.65, "FS,Draconis March,Robinson Operational Area,Dahar PDZ"], ["McGehee", 330.34, 74.92, "FS,Draconis March,Robinson Operational Area,Dahar PDZ"], ["Rowe", 333.19, 48.04, "FS,Draconis March,Robinson Operational Area,Dahar PDZ"], ["Sakhara V", 276.59, 34.08, "FS,Draconis March,Robinson Operational Area,Dahar PDZ"], ["Tallmadge", 276.06, 41.83, "FS,Draconis March,Robinson Operational Area,Dahar PDZ"], ["Tishomingo", 315.62, 46.22, "FS,Draconis March,Robinson Operational Area,Dahar PDZ"], ["Crossing", 253.31, 47.26, "FS,Draconis March,Robinson Operational Area,Raman PDZ"], ["Colia", 357.49, 66.91, "FS,Draconis March,Woodbine Operational Area,Bremond PDZ"], ["Fairfax", 353.34, 31.21, "FS,Draconis March,Woodbine Operational Area,Bremond PDZ"], ["Fallon II", 367.83, 48.55, "FS,Draconis March,Woodbine Operational Area,Bremond PDZ"], ["Melcher", 367.31, 38.47, "FS,Draconis March,Woodbine Operational Area,Bremond PDZ"], ["Sun Prairie", 325.18, 28.9, "FS,Draconis March,Woodbine Operational Area,Bremond PDZ"], ["Waunakee", 317.42, 14.95, "FS,Draconis March,Woodbine Operational Area,Bremond PDZ"], ["Verde", 349.99, 12.62, "FS,Draconis March,Woodbine Operational Area,Mayetta PDZ"], ["Cartago", 139.84, -10.13, "FS,Draconis March,Robinson Operational Area,Kentares PDZ"], ["Clovis", 180.17, 3.06, "FS,Draconis March,Robinson Operational Area,Kentares PDZ"], ["Elbar", 126.65, -8.06, "FS,Draconis March,Robinson Operational Area,Kentares PDZ"], ["Exeter", 188.43, -8.06, "FS,Draconis March,Robinson Operational Area,Kentares PDZ"], ["Kentares IV", 149.4, -13.23, "FS,Draconis March,Robinson Operational Area,Kentares PDZ"], ["Olancha", 167.24, -6.51, "FS,Draconis March,Robinson Operational Area,Kentares PDZ"], ["Doneval II", 198.78, 8.74, "FS,Draconis March,Robinson Operational Area,Le Blanc PDZ"], ["Le Blanc", 207.05, 18.31, "FS,Draconis March,Robinson Operational Area,Le Blanc PDZ"], ["Raman", 161.55, 9.26, "FS,Draconis March,Robinson Operational Area,Raman PDZ"], ["Xhosa VII", 173.96, 14.42, "FS,Draconis March,Robinson Operational Area,Raman PDZ"], ["Galtor III", 194.12, 73.11, "FS,Draconis March,Robinson Operational Area,Raman PDZ"], ["Marduk", 208.34, 59.93, "FS,Draconis March,Robinson Operational Area,Raman PDZ"], ["Deshler", 215.07, 74.4, "FS,Draconis March,Robinson Operational Area,Raman PDZ"], ["Allerton", 263.4, 7.19, "FS,Draconis March,Robinson Operational Area,Le Blanc PDZ"], ["Emporia", 256.66, -6.5, "FS,Draconis March,Robinson Operational Area,Le Blanc PDZ"], ["Franklin", 250.74, 10.81, "FS,Draconis March,Robinson Operational Area,Le Blanc PDZ"], ["Lucerne", 231.86, 12.36, "FS,Draconis March,Robinson Operational Area,Le Blanc PDZ"], ["Maynard", 304.5, 2.28, "FS,Draconis March,Robinson Operational Area,Le Blanc PDZ"], ["New Ivaarsen", 226.95, 34.59, "FS,Draconis March,Robinson Operational Area,Le Blanc PDZ"], ["Rochester", 226.95, 3.06, "FS,Draconis March,Robinson Operational Area,Le Blanc PDZ"], ["Sauk City", 276.59, -3.15, "FS,Draconis March,Robinson Operational Area,Le Blanc PDZ"], ["Tarkio", 317.42, -0.05, "FS,Draconis March,Robinson Operational Area,Le Blanc PDZ"], ["Lima", 235.74, 53.98, "FS,Draconis March,Robinson Operational Area,Raman PDZ"], ["McComb", 222.3, 57.6, "FS,Draconis March,Robinson Operational Area,Raman PDZ"], ["Royal", 222.56, 44.42, "FS,Draconis March,Robinson Operational Area,Raman PDZ"], ["Robinson", 232.72, -6.48, "FS,Draconis March,Robinson Operational Area,Le Blanc PDZ,Major Capital"], ["Benedict", 473.29, -11.43, "FS,Draconis March,Woodbine Operational Area,Mayetta PDZ"], ["Chanute", 463.74, 23.47, "FS,Draconis March,Woodbine Operational Area,Mayetta PDZ"], ["Hickok", 432.19, -4.96, "FS,Draconis March,Woodbine Operational Area,Mayetta PDZ"], ["Junior", 399.62, 0.99, "FS,Draconis March,Woodbine Operational Area,Mayetta PDZ"], ["Linneus", 450.29, -8.06, "FS,Draconis March,Woodbine Operational Area,Mayetta PDZ"], ["Mayetta", 405.31, 6.93, "FS,Draconis March,Woodbine Operational Area,Mayetta PDZ"], ["Mirage", 475.1, 15.46, "FS,Draconis March,Woodbine Operational Area,Mayetta PDZ"], ["Nagel", 470.97, 6.41, "FS,Draconis March,Woodbine Operational Area,Mayetta PDZ"], ["Princton", 413.31, 26.32, "FS,Draconis March,Woodbine Operational Area,Mayetta PDZ"], ["Protection", 451.84, 5.38, "FS,Draconis March,Woodbine Operational Area,Mayetta PDZ"], ["Savonburg", 498.1, -15.56, "FS,Draconis March,Woodbine Operational Area,Mayetta PDZ"], ["Sylvan", 423.15, 3.06, "FS,Draconis March,Woodbine Operational Area,Mayetta PDZ"], ["Urich", 429.35, 18.83, "FS,Draconis March,Woodbine Operational Area,Mayetta PDZ"], ["Brundage", 403.5, 49.32, "FS,Draconis March,Woodbine Operational Area,Bremond PDZ"], ["Morrill", 396.01, 31.75, "FS,Draconis March,Woodbine Operational Area,Bremond PDZ"], ["Ottumwa", 398.59, 33.3, "FS,Draconis March,Woodbine Operational Area,Bremond PDZ"], ["Brookeland", 440.2, 70.52, "FS,Draconis March,Woodbine Operational Area,Bryceland PDZ"], ["De Berry", 446.67, 62.5, "FS,Draconis March,Woodbine Operational Area,Bryceland PDZ"], ["Diboll", 475.36, 67.16, "FS,Draconis March,Woodbine Operational Area,Bryceland PDZ"], ["Haynesville", 455.2, 79.57, "FS,Draconis March,Woodbine Operational Area,Bryceland PDZ"], ["Pascagoula", 429.61, 57.34, "FS,Draconis March,Woodbine Operational Area,Bryceland PDZ"], ["Adrian", 449.25, 28.13, "FS,Draconis March,Woodbine Operational Area,Milligan PDZ"], ["Broaddus", 465.03, 55.78, "FS,Draconis March,Woodbine Operational Area,Milligan PDZ"], ["Greeley", 449.25, 40.27, "FS,Draconis March,Woodbine Operational Area,Milligan PDZ"], ["Milligan", 475.1, 38.73, "FS,Draconis March,Woodbine Operational Area,Milligan PDZ"], ["Crofton", 522.91, -78.11, "FS,Crucis March,Minette Operational Area,Anjin Muerto Combat Region"], ["Des Arc", 496.57, -83.54, "FS,Crucis March,Minette Operational Area,Anjin Muerto Combat Region"], ["Hahira", 550.06, -100.64, "FS,Crucis March,Minette Operational Area,Anjin Muerto Combat Region"], ["Hoyleton", 506.13, -51.75, "FS,Crucis March,Minette Operational Area,Anjin Muerto Combat Region"], ["McRae", 553.18, -84.57, "FS,Crucis March,Minette Operational Area,Anjin Muerto Combat Region"], ["Mermentau", 521.36, -39.33, "FS,Crucis March,Minette Operational Area,Anjin Muerto Combat Region"], ["Metter", 533.26, -98.01, "FS,Crucis March,Minette Operational Area,Anjin Muerto Combat Region"], ["Rentz", 570.49, -98.01, "FS,Crucis March,Minette Operational Area,Anjin Muerto Combat Region"], ["Shawnee", 552.91, -65.44, "FS,Crucis March,Minette Operational Area,Anjin Muerto Combat Region"], ["Steinhatchee", 522.15, -96.98, "FS,Crucis March,Minette Operational Area,Anjin Muerto Combat Region"], ["Symsonia", 486.74, -95.69, "FS,Crucis March,Minette Operational Area,Anjin Muerto Combat Region"], ["Vandalia", 477.69, -66.22, "FS,Crucis March,Minette Operational Area,Anjin Muerto Combat Region"], ["Zolfo", 527.32, -71.91, "FS,Crucis March,Minette Operational Area,Anjin Muerto Combat Region"], ["Anjin Muerto", 586.51, -78.11, "FS,Crucis March,Minette Operational Area,Anjin Muerto Combat Region"], ["Adelson", 472.77, -245.35, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Brockton", 531.98, -119.18, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Cogdell", 521.9, -141.51, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Ebro", 563.76, -129.59, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Eustatius", 458.05, -198.58, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Fetsund", 446.67, -241.0, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Fuveau", 440.45, -232.67, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Gillingham", 500.69, -211.46, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Hephzibah", 457.52, -167.55, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Hortense", 488.03, -144.56, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Jaboatao", 481.31, -212.06, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Jesup", 500.43, -121.56, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Lihue", 424.17, -198.57, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Mejicanos", 472.25, -181.72, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Memphis", 562.21, -141.68, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Morven", 544.37, -147.13, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Moultrie", 471.74, -170.62, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Olindo", 463.21, -234.75, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Redondo", 454.68, -213.64, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Sabanillas", 433.74, -176.37, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Sherwood", 563.75, -118.69, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Sodertalje", 493.98, -235.25, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Vaucluse", 496.82, -162.1, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Waimalu", 408.14, -178.45, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Waipahu", 426.51, -187.97, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Quimper (Chirac 3130+)", 380.42, -239.33, "A"], ["As Samik", 346.89, -286.69, "FS,Crucis March,Chirikof Operational Area,Islamabad Combat Region"], ["Basantapur", 364.47, -284.41, "FS,Crucis March,Chirikof Operational Area,Islamabad Combat Region"], ["Belaire", 334.49, -274.3, "FS,Crucis March,Chirikof Operational Area,Islamabad Combat Region"], ["Birmensdorf", 383.08, -270.93, "FS,Crucis March,Chirikof Operational Area,Islamabad Combat Region"], ["Cambiano", 351.54, -241.98, "FS,Crucis March,Chirikof Operational Area,Islamabad Combat Region"], ["Darwendale", 311.73, -262.9, "FS,Crucis March,Chirikof Operational Area,Islamabad Combat Region"], ["Gambarare", 357.24, -269.94, "FS,Crucis March,Chirikof Operational Area,Islamabad Combat Region"], ["Hecheng", 332.31, -266.25, "FS,Crucis March,Chirikof Operational Area,Islamabad Combat Region"], ["Islamabad", 321.56, -254.18, "FS,Crucis March,Chirikof Operational Area,Islamabad Combat Region"], ["Macintosh", 358.51, -264.98, "FS,Crucis March,Chirikof Operational Area,Islamabad Combat Region"], ["Naka Pabni", 377.91, -291.64, "FS,Crucis March,Chirikof Operational Area,Islamabad Combat Region"], ["Panpour", 342.5, -292.44, "FS,Crucis March,Chirikof Operational Area,Islamabad Combat Region"], ["Tentativa", 349.73, -302.25, "FS,Crucis March,Chirikof Operational Area,Islamabad Combat Region"], ["Agliana", 389.81, -289.56, "FS,Crucis March,Chirikof Operational Area,Kearny Combat Region"], ["Baranda", 449.25, -259.03, "FS,Crucis March,Chirikof Operational Area,Kearny Combat Region"], ["Gronholt", 466.05, -261.11, "FS,Crucis March,Chirikof Operational Area,Kearny Combat Region"], ["Hoonaar", 460.63, -264.98, "FS,Crucis March,Chirikof Operational Area,Kearny Combat Region"], ["Malagrotta", 428.05, -271.23, "FS,Crucis March,Chirikof Operational Area,Kearny Combat Region"], ["Gurrnazovo", 423.41, -240.7, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["Jodipur (Neukirchen 3025+)", 406.35, -247.14, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["Killarney", 402.2, -203.73, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["Niquinohomo", 407.64, -226.72, "FS,Crucis March,Chirikof Operational Area,Remagen Combat Region"], ["June", 405.83, -264.19, "FS,Crucis March,Chirikof Operational Area,Kearny Combat Region"], ["Sartu (Bastille 3130+)", 297.22, -342.83, "A"], ["Anaheim", 299.33, -311.76, "FS,Capellan March,Taygeta Operational Area,Warren PDZ"], ["Brusett", 245.56, -328.12, "FS,Capellan March,Taygeta Operational Area,Warren PDZ"], ["Die Moot", 284.33, -302.74, "FS,Capellan March,Taygeta Operational Area,Warren PDZ"], ["Drienfontein", 271.15, -290.36, "FS,Capellan March,Taygeta Operational Area,Warren PDZ"], ["Enchi", 294.42, -287.78, "FS,Capellan March,Taygeta Operational Area,Warren PDZ"], ["Firgrove", 249.96, -298.88, "FS,Capellan March,Taygeta Operational Area,Warren PDZ"], ["Hyalite", 268.82, -354.19, "FS,Capellan March,Taygeta Operational Area,Warren PDZ"], ["Keuterville", 275.78, -311.68, "FS,Capellan March,Taygeta Operational Area,Warren PDZ"], ["Kiserian", 285.88, -279.26, "FS,Capellan March,Taygeta Operational Area,Warren PDZ"], ["Lothair", 266.23, -337.13, "FS,Capellan March,Taygeta Operational Area,Warren PDZ"], ["Marodzi", 292.09, -274.6, "FS,Capellan March,Taygeta Operational Area,Warren PDZ"], ["Warren", 298.03, -328.32, "FS,Capellan March,Taygeta Operational Area,Warren PDZ"], ["Weippe", 317.42, -307.11, "FS,Capellan March,Taygeta Operational Area,Warren PDZ"], ["Caldwell", 332.59, -325.18, "FS,Crucis March,Chirikof Operational Area,Islamabad Combat Region"], ["Montour", 348.7, -328.61, "FS,Crucis March,Chirikof Operational Area,Islamabad Combat Region"], ["Pierce", 343.01, -310.48, "FS,Crucis March,Chirikof Operational Area,Islamabad Combat Region"], ["Songgang", 327.76, -299.67, "FS,Crucis March,Chirikof Operational Area,Islamabad Combat Region"], ["Tegaldanas", 310.18, -279.75, "FS,Crucis March,Chirikof Operational Area,Islamabad Combat Region"], ["Cyrton", 364.13, -343.27, "TC"], ["Organo", 355.77, -347.0, "TC"], ["Amber Grove", 272.88, -362.39, "TC,Perdition Union"], ["Celentaro", 339.94, -348.98, "TC,Perdition Union"], ["Logan's Land", 323.67, -356.68, "TC,Perdition Union"], ["Norman's World", 330.48, -353.6, "TC,Perdition Union"], ["Perdition", 306.96, -356.68, "TC,Perdition Union,Major Capital"], ["Abbeville", 605.9, -39.85, "FS,Draconis March,Woodbine Operational Area,Kilbourne PDZ"], ["Arnaudville", 583.66, 36.66, "FS,Draconis March,Woodbine Operational Area,Kilbourne PDZ"], ["Bassfield", 588.83, 4.87, "FS,Draconis March,Woodbine Operational Area,Kilbourne PDZ"], ["Bastrop", 563.4, 61.71, "FS,Draconis March,Woodbine Operational Area,Kilbourne PDZ"], ["Beaumont", 583.94, 39.76, "FS,Draconis March,Woodbine Operational Area,Kilbourne PDZ"], ["Boondock", 590.9, 21.41, "FS,Draconis March,Woodbine Operational Area,Kilbourne PDZ"], ["Cohay", 610.04, 11.33, "FS,Draconis March,Woodbine Operational Area,Kilbourne PDZ"], ["Delos IV", 613.41, 59.93, "FS,Draconis March,Woodbine Operational Area,Kilbourne PDZ"], ["Farnsworth", 561.44, 31.49, "FS,Draconis March,Woodbine Operational Area,Kilbourne PDZ"], ["Hazelhurst", 550.07, 65.35, "FS,Draconis March,Woodbine Operational Area,Kilbourne PDZ"], ["Inner End", 587.3, 75.17, "FS,Draconis March,Woodbine Operational Area,Kilbourne PDZ"], ["Kilbourne", 571.78, 43.64, "FS,Draconis March,Woodbine Operational Area,Kilbourne PDZ"], ["Millray", 610.55, 31.75, "FS,Draconis March,Woodbine Operational Area,Kilbourne PDZ"], ["Pattison", 587.66, 54.5, "FS,Draconis March,Woodbine Operational Area,Kilbourne PDZ"], ["Sterlington", 524.21, 53.72, "FS,Draconis March,Woodbine Operational Area,Kilbourne PDZ"], ["Tangipahoa", 589.35, -21.51, "FS,Draconis March,Woodbine Operational Area,Kilbourne PDZ"], ["Thibodaux", 576.17, -7.54, "FS,Draconis March,Woodbine Operational Area,Kilbourne PDZ"], ["Offerman", 573.32, -52.26, "FS,Crucis March,Minette Operational Area,Anjin Muerto Combat Region"], ["Okefenokee", 606.93, -67.51, "FS,Crucis March,Minette Operational Area,Anjin Muerto Combat Region"], ["Alta Vista", 506.64, 12.88, "FS,Draconis March,Woodbine Operational Area,Milligan PDZ"], ["Altoona (FS)", 550.57, -4.18, "FS,Draconis March,Woodbine Operational Area,Milligan PDZ"], ["Chenier", 580.57, -41.41, "FS,Draconis March,Woodbine Operational Area,Milligan PDZ"], ["Delacambre", 539.71, 4.87, "FS,Draconis March,Woodbine Operational Area,Milligan PDZ"], ["Humansville", 552.89, -32.36, "FS,Draconis March,Woodbine Operational Area,Milligan PDZ"], ["Inman", 556.02, 7.19, "FS,Draconis March,Woodbine Operational Area,Milligan PDZ"], ["Kirbyville", 507.16, 51.14, "FS,Draconis March,Woodbine Operational Area,Milligan PDZ"], ["Kountze", 524.47, 27.09, "FS,Draconis March,Woodbine Operational Area,Milligan PDZ"], ["Neosho", 549.8, -25.64, "FS,Draconis March,Woodbine Operational Area,Milligan PDZ"], ["Rosepine", 584.18, -22.79, "FS,Draconis March,Woodbine Operational Area,Milligan PDZ"], ["Stratford", 526.27, 38.99, "FS,Draconis March,Woodbine Operational Area,Milligan PDZ"], ["Vibrunum", 531.45, -20.72, "FS,Draconis March,Woodbine Operational Area,Milligan PDZ"], ["Winfield", 537.4, 23.47, "FS,Draconis March,Woodbine Operational Area,Milligan PDZ"], ["Woodbine", 503.68, 23.77, "FS,Draconis March,Woodbine Operational Area,Milligan PDZ,Minor Capital"], ["Broken Wheel", 534.29, -173.5, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Lackland", 546.47, -173.8, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Mararn", 526.53, -219.98, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Marielund", 527.92, -179.87, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Skepptana", 529.9, -191.04, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Wetumpka", 527.32, -164.48, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Filtvelt", 506.64, -181.53, "FS,Crucis March,Minette Operational Area,Broken Wheel Combat Region"], ["Helios", -368.23, -411.4, "U"], ["McEvedy's Folly", -408.06, -493.99, "U"], ["Green Stone (Clayborne II 3025+)", -405.91, -79.96, "CF"], ["Helbrent (Andiron 3025+)", -424.48, -47.39, "CF"], ["Himmels (Baltazar III 3025+)", -440.09, -59.55, "CF"], ["Iolas (Diedre's Den 3025+)", -417.61, -62.53, "CF"], ["Thadora's Land", -442.84, -90.99, "CF"], ["Zorn's Keep", -428.85, -112.79, "CF"], ["Erin (Von Strang's World 2830+)", -160.07, 515.89, "I"], ["Star's End (Novo Cressidas)", -83.24, 432.15, "I"], ["Enif", 429.09, 288.69, "DC,Galedon Military District,Tabayama Prefecture"], ["Altona", 283.55, 421.58, "DC,Pesht Military District,Bjarred Prefecture"], ["Tarnby", 266.76, 429.08, "DC,Pesht Military District,Bjarred Prefecture"], ["Kokpekty", 412.81, 302.39, "DC,Pesht Military District,Ningxia Prefecture"], ["Gravenhage", 304.75, 425.98, "DC,Pesht Military District,Qandahar Prefecture"], ["Nowhere", 369.12, 403.2, "DC,Pesht Military District,Qandahar Prefecture"], ["Farstar", 412.98, 443.52, "I"], ["Cohagen", 372.22, -316.23, "FS,Crucis March,Chirikof Operational Area,Islamabad Combat Region"], ["Verdigreis", 372.74, -330.69, "FS,Crucis March,Chirikof Operational Area,Islamabad Combat Region"], ["Armington", 420.82, -303.74, "FS,Crucis March,Chirikof Operational Area,Kearny Combat Region"], ["Csomad", 427.28, -292.14, "FS,Crucis March,Chirikof Operational Area,Kearny Combat Region"], ["Estuan", 396.52, -306.72, "FS,Crucis March,Chirikof Operational Area,Kearny Combat Region"], ["Great Gorge", 492.68, -266.87, "FS,Crucis March,Chirikof Operational Area,Kearny Combat Region"], ["Vackisujfalu", 466.31, -286.49, "FS,Crucis March,Chirikof Operational Area,Kearny Combat Region"], ["Hivrannee", 626.06, -5.99, "FS,Draconis March,Woodbine Operational Area,Kilbourne PDZ"], ["Kentwood", 627.34, -20.2, "FS,Draconis March,Woodbine Operational Area,Kilbourne PDZ"], ["Aconcagua", -275.03, -189.63, "FWL"], ["Albert Falls", -259.83, -132.29, "FWL"], ["Ashburton", -263.45, -139.9, "FWL"], ["Aylmer", -390.83, -141.98, "FWL"], ["Bowang", -315.09, -159.33, "FWL"], ["Cajamarca", -243.24, -162.89, "FWL"], ["Chalouba", -277.93, -141.69, "FWL"], ["Corbeanca", -350.49, -235.84, "FWL"], ["Eromanga", -283.87, -118.49, "FWL"], ["Glevakha", -206.77, -303.73, "FWL"], ["Hednesford", -365.92, -228.85, "FWL"], ["Hiratsuka", -258.5, -253.39, "FWL"], ["Home", -278.62, -163.99, "FWL"], ["Howrah", -219.75, -279.25, "FWL"], ["Isabela", -270.89, -242.48, "FWL"], ["Jubka", -338.69, -210.47, "FWL"], ["Kakada", -290.32, -124.64, "FWL"], ["Kendall", -370.2, -200.86, "FWL"], ["Kutludugun", -331.45, -190.55, "FWL"], ["Lengkong", -239.07, -259.04, "FWL"], ["Mackenzie", -275.55, -207.89, "FWL"], ["Panjang", -297.76, -181.72, "FWL"], ["Prato", -335.32, -225.43, "FWL"], ["Sharqah", -220.74, -292.14, "FWL"], ["Stotzing", -348.51, -201.45, "FWL"], ["Tchamba", -300.93, -147.63, "FWL"], ["Valil'yevskiy", -329.57, -178.15, "FWL"], ["Wolof", -298.85, -156.65, "FWL"], ["Al Jubaylah", -183.77, -281.83, "FWL"], ["Ayn Tarma", -172.47, -302.75, "FWL"], ["Barlaston", -123.6, -266.57, "FWL"], ["Cap Rouge", -123.61, -307.7, "FWL"], ["Chagos", -263.65, -226.23, "FWL"], ["Chilung", -123.6, -247.14, "FWL"], ["Cirebon", -147.09, -263.2, "FWL"], ["Cole Harbour", -121.03, -292.44, "FWL"], ["Elektrougli", -113.19, -184.11, "FWL"], ["Eleusis", -166.52, -341.99, "FWL"], ["Fadiffolu", -243.53, -242.78, "FWL"], ["Fieferana", -172.96, -268.85, "FWL"], ["Guangzho", -109.83, -285.4, "FWL"], ["Hindmarsh", -195.46, -271.72, "FWL"], ["Kanata", -96.15, -307.87, "FWL"], ["Kearny", -127.17, -274.6, "FWL"], ["Lahti", -392.41, -223.15, "FWL"], ["Mauripur", -167.21, -281.83, "FWL"], ["Meadowvale", -134.9, -322.17, "FWL"], ["Obrenovac", -187.43, -335.55, "FWL"], ["Payvand", -202.4, -317.22, "FWL"], ["Rohinjan", -190.8, -303.04, "FWL"], ["Ruschegg", -175.24, -321.08, "FWL"], ["San Nicolas", -390.33, -168.34, "FWL"], ["Saonara", -171.18, -313.35, "FWL"], ["Scheuerheck", -147.89, -328.61, "FWL"], ["Siendou", -113.99, -291.7, "FWL"], ["Sierra", -411.23, -111.75, "FWL"], ["Skvorec", -158.2, -307.7, "FWL"], ["Tapachula", -260.58, -212.55, "FWL"], ["Vikindu", -128.96, -259.53, "FWL"], ["Wilkes", -212.21, -273.51, "FWL"], ["Wisconsin", -158.7, -296.8, "FWL"], ["Yanchep", -133.42, -287.28, "FWL"], ["Shasta", -218.2, -102.7, "FWL"], ["Asellus Australis", -100.01, -113.83, "FWL"], ["Asellus Borealis", -100.61, -118.19, "FWL"], ["Merton", -392.71, -121.76, "FWL"], ["Sackville", -391.12, -128.99, "FWL"], ["Lungdo", -82.73, -121.76, "FWL"], ["Sorunda", -65.14, -122.85, "FWL"], ["Jiddah", -279.41, -236.04, "FWL"], ["Karakiraz", -305.29, -199.37, "FWL"], ["Rzhishchev", -294.48, -222.07, "FWL"], ["Westover", -304.49, -210.47, "FWL"], ["Ideyld", -201.41, -97.5, "FWL"], ["Mundrabilla", -247.89, -108.38, "FWL"], ["Rexburg", -199.52, -69.84, "FWL"], ["Sterling", -191.54, -70.91, "FWL"], ["Gomeisa", -49.38, -127.01, "FWL"], ["Ling", -43.95, -121.07, "FWL"], ["Dayr Khuna", -113.79, -196.5, "FWL,Duchy of Oriente"], ["Manihiki", -207.36, -168.05, "FWL,Marik Commonwealth"], ["Coriscana", -187.93, -109.17, "FWL,Marik Commonwealth"], ["Midkiff", -198.53, -111.95, "FWL,Marik Commonwealth"], ["Hudeiba", -78.58, -285.4, "FWL,Mosiro Archipelago"], ["Aitutaki", -164.64, -166.56, "FWL,Principality of Regulus"], ["Sophie's World", -102.59, -131.87, "FWL,The Protectorate"], ["Alfirk", 588.6, 454.17, "I"], ["Antallos (Port Krin)", 463.23, 281.42, "I"], ["Badlands Cluster (50) (Pirates Haven 3025+)", 424.96, -349.83, "I"], ["Hope IV (Randis IV 2988+)", 621.54, -342.98, "I"], ["Mica", 679.86, 17.15, "I"], ["New St. Andrews", -513.03, -107.97, "I"], ["Niops", -374.01, -263.17, "I"], ["Novo Franklin", 667.89, 61.54, "I"], ["Rezak's Hole", 418.43, 339.17, "U"], ["Langhorne", -429.09, 228.47, "LC,Protectorate of Donegal,Alarion Province"], ["Ormstown", -438.89, 193.57, "LC,Protectorate of Donegal,Alarion Province"], ["Althastan", -432.45, -26.15, "LC,Protectorate of Donegal,Alarion Province"], ["Khon Kaen", -384.38, -46.31, "LC,Protectorate of Donegal,Alarion Province"], ["Madiun", -400.44, -36.75, "LC,Protectorate of Donegal,Alarion Province"], ["Son Hoa", -421.05, -36.49, "LC,Protectorate of Donegal,Alarion Province"], ["Paulinus", -481.26, -254.71, "LL"], ["Ballad II", -269.75, -465.07, "A"], ["Crawford's Delight", -209.07, -519.38, "A"], ["Thraxa", -322.08, -378.0, "MOC"], ["Vixen", -292.62, -390.1, "A"], ["Baliggora", 590.77, 154.37, "OA,Baliggora Province"], ["Ferris (OA)", 583.67, 126.87, "OA,Baliggora Province"], ["Raldamax", 596.4, 141.35, "OA,Baliggora Province"], ["Trimaldix", 571.73, 131.74, "OA,Baliggora Province"], ["Valasha", 588.78, 93.27, "OA,Baliggora Province"], ["Caldarium", -444.77, 234.44, "I"], ["Slewis", -475.36, 216.57, "I"], ["Althea's Choice", 380.17, -340.19, "TC"], ["Cadiz (TC)", 328.08, -424.04, "U"], ["Celano", 323.46, -484.15, "U"], ["Charleston", 409.65, -389.51, "U"], ["Davetal", 271.5, -446.98, "U"], ["Hellespont", 235.53, -512.46, ""], ["Orkney (TC)", 378.87, -399.3, "U"], ["Argos", 177.46, -484.34, "U"], ["Atreus Prime", 227.71, -373.56, "TC,Hyades Union"], ["Burton", 185.43, -420.74, "TC,Hyades Union"], ["Carthage", 199.05, -464.19, "U"], ["Flaum", 182.35, -415.47, "TC,Hyades Union"], ["Mithron", 224.45, -363.58, "TC,Hyades Union"], ["Regis Roost", 153.51, -442.23, "U"], ["Spitz", 221.01, -429.17, "U"], ["Dicallus", 342.14, -373.17, "TC,Perdition Union"], ["Euschelus", 280.79, -389.43, "TC,Perdition Union"], ["Grossbach", 310.04, -366.79, "TC,Perdition Union"], ["Sterope", 266.76, -404.33, "TC,Perdition Union"], ["Carcri", 701.74, -110.38, "U"], ["Cephei", 688.62, -80.36, "U"], ["Pegasi", 677.58, -134.37, "U"], ["Ålborg", 558.19, 503.96, "JF"], ["Hamar", 597.25, 499.98, "JF"], ["Hofn", 605.4, 549.99, "JF"], ["Trondheim (JF)", 581.72, 531.05, "JF"], ["Zanderij", -178.12, 265.43, "LC,Protectorate of Donegal,Coventry Province"], ["Atocongo", -170.88, 245.26, "LC,Protectorate of Donegal,District of Donegal"], ["Bountiful Harvest", -137.28, 261.03, "LC,Protectorate of Donegal,District of Donegal"], ["Cumbres", -154.03, 201.83, "LC,Protectorate of Donegal,District of Donegal"], ["Dukambia", -181.99, 213.73, "LC,Protectorate of Donegal,District of Donegal"], ["Esteros", -157.66, 268.59, "LC,Protectorate of Donegal,District of Donegal"], ["Grunwald", -97.46, 203.13, "LC,Protectorate of Donegal,District of Donegal"], ["Hamilton (LC)", -150.76, 222.0, "LC,Protectorate of Donegal,District of Donegal"], ["Kandersteg", -120.73, 227.95, "LC,Protectorate of Donegal,District of Donegal"], ["Lyndon", -127.48, 196.16, "LC,Protectorate of Donegal,District of Donegal"], ["New Exford", -137.28, 243.19, "LC,Protectorate of Donegal,District of Donegal"], ["Odessa ('The Ruins of Gabriel')", -120.73, 185.55, "LC,Protectorate of Donegal,District of Donegal"], ["Summit", -116.87, 209.59, "LC,Protectorate of Donegal,District of Donegal"], ["Ballynure", -82.2, 246.3, "LC,Tamar Pact,Tamar Domains"], ["Graceland", -100.61, 246.04, "LC,Tamar Pact,Tamar Domains"], ["Pandora", -84.55, 234.79, "LC,Tamar Pact,Tamar Domains"], ["Arc-Royal", -170.39, 226.58, "LC,Protectorate of Donegal,District of Donegal"], ["Colinas", -157.4, 108.0, "LC,Protectorate of Donegal,Bolan Province"], ["Jaumegarde", -140.65, 98.18, "LC,Protectorate of Donegal,Bolan Province"], ["Turinge", -160.57, 96.89, "LC,Protectorate of Donegal,Bolan Province"], ["Drosendorf", -259.0, 41.31, "LC,Protectorate of Donegal,Bolan Province"], ["Gypsum", -281.49, 26.06, "LC,Protectorate of Donegal,Bolan Province"], ["Kitzingen", -223.12, 47.0, "LC,Protectorate of Donegal,Bolan Province"], ["Medzev", -255.43, 46.73, "LC,Protectorate of Donegal,Bolan Province"], ["Zvolen", -243.53, 49.06, "LC,Protectorate of Donegal,Bolan Province"], ["Bjornlunda", -149.97, 88.35, "LC,Protectorate of Donegal,Bolan Province"], ["Chukchi III", -180.69, 90.43, "LC,Protectorate of Donegal,Bolan Province"], ["Gallery", -198.24, 108.27, "LC,Protectorate of Donegal,Bolan Province"], ["Thuban", -196.26, 117.82, "LC,Protectorate of Donegal,Bolan Province"], ["Uzhgorod", -214.0, 56.83, "LC,Protectorate of Donegal,Bolan Province"], ["Canonbie", -122.02, 67.16, "LC,Federation of Skye,Rahneshire"], ["Ciotat", -154.63, 74.4, "LC,Protectorate of Donegal,Bolan Province"], ["Eidsfoss", -153.54, 58.89, "LC,Protectorate of Donegal,Bolan Province"], ["Furillo", -137.27, 78.26, "LC,Protectorate of Donegal,Bolan Province"], ["Hesperus II", -123.6, 46.73, "LC,Federation of Skye,Rahneshire"], ["Trent", -131.83, 58.11, "LC,Protectorate of Donegal,Bolan Province"], ["Aristotle", -183.57, 65.09, "LC,Protectorate of Donegal,Bolan Province"], ["Clinton", -165.92, 53.98, "LC,Protectorate of Donegal,Bolan Province"], ["Hollabrunn", -208.35, 33.3, "LC,Protectorate of Donegal,Bolan Province"], ["Soilihull", -188.22, 46.22, "LC,Protectorate of Donegal,Bolan Province"], ["Bolan", -277.97, 5.19, "LC,Protectorate of Donegal,Bolan Province,Minor Capital"], ["Abejorral", -299.34, 127.39, "LC,Protectorate of Donegal,Alarion Province"], ["Calafell", -366.54, 130.23, "LC,Protectorate of Donegal,Alarion Province"], ["Ciampino", -331.45, 166.95, "LC,Protectorate of Donegal,Alarion Province"], ["Duran", -263.16, 144.71, "LC,Protectorate of Donegal,Alarion Province"], ["Jatznik", -302.22, 191.5, "LC,Protectorate of Donegal,Alarion Province"], ["Kvistgard", -332.44, 151.95, "LC,Protectorate of Donegal,Alarion Province"], ["Minderoo", -255.63, 155.05, "LC,Protectorate of Donegal,Alarion Province"], ["Noisiel", -308.36, 148.07, "LC,Protectorate of Donegal,Alarion Province"], ["Nuneaton", -335.52, 141.87, "LC,Protectorate of Donegal,Alarion Province"], ["Quilino", -323.63, 154.54, "LC,Protectorate of Donegal,Alarion Province"], ["Reese Station", -292.6, 170.82, "LC,Protectorate of Donegal,Alarion Province"], ["Tapihue", -293.69, 186.33, "LC,Protectorate of Donegal,Alarion Province"], ["Tiruppur", -306.07, 162.8, "LC,Protectorate of Donegal,Alarion Province"], ["Vendrell", -315.9, 125.84, "LC,Protectorate of Donegal,Alarion Province"], ["Vermezzo", -361.68, 162.3, "LC,Protectorate of Donegal,Alarion Province"], ["Vihtijarvi", -354.45, 146.52, "LC,Protectorate of Donegal,Alarion Province"], ["Batajnica", -369.91, 118.35, "LC,Protectorate of Donegal,Alarion Province"], ["Carlisle", -304.98, 88.88, "LC,Protectorate of Donegal,Alarion Province"], ["Czarvowo", -317.48, 61.48, "LC,Protectorate of Donegal,Alarion Province"], ["Lancaster (LC)", -268.31, 110.33, "LC,Protectorate of Donegal,Alarion Province"], ["Mezzana", -357.52, 84.74, "LC,Protectorate of Donegal,Alarion Province"], ["Novara", -366.33, 115.65, "LC,Protectorate of Donegal,Alarion Province"], ["Premana", -366.54, 61.47, "LC,Protectorate of Donegal,Alarion Province"], ["Rijeka", -338.88, 95.34, "LC,Protectorate of Donegal,Alarion Province"], ["Smolnik", -253.35, 110.84, "LC,Protectorate of Donegal,Alarion Province"], ["York (LC)", -279.41, 114.73, "LC,Protectorate of Donegal,Alarion Province"], ["Zaprudy", -320.06, 92.76, "LC,Protectorate of Donegal,Alarion Province"], ["Acrux", -352.03, 40.75, "LC,Protectorate of Donegal,Alarion Province"], ["Danxian", -347.41, 17.27, "LC,Protectorate of Donegal,Alarion Province"], ["Ellijay", -334.03, 7.71, "LC,Protectorate of Donegal,Alarion Province"], ["Herzberg", -309.95, 21.41, "LC,Protectorate of Donegal,Alarion Province"], ["Loburg", -324.72, 10.29, "LC,Protectorate of Donegal,Alarion Province"], ["Maisons", -346.13, 4.35, "LC,Protectorate of Donegal,Alarion Province"], ["Radostov", -308.16, 43.9, "LC,Protectorate of Donegal,Alarion Province"], ["Akfata", -381.8, 176.25, "LC,Protectorate of Donegal,Alarion Province"], ["Enzesfled", -380.51, 128.94, "LC,Protectorate of Donegal,Alarion Province"], ["Etiler", -378.23, 199.0, "LC,Protectorate of Donegal,Alarion Province"], ["Ferihegy", -390.12, 161.51, "LC,Protectorate of Donegal,Alarion Province"], ["Kaumberg", -387.84, 144.45, "LC,Protectorate of Donegal,Alarion Province"], ["Kelang", -357.23, 200.8, "LC,Protectorate of Donegal,Alarion Province"], ["Kostinbrod", -374.87, 157.9, "LC,Protectorate of Donegal,Alarion Province"], ["Sappir", -367.62, 218.65, "LC,Protectorate of Donegal,Alarion Province"], ["Triesting", -350.49, 189.44, "LC,Protectorate of Donegal,Alarion Province"], ["Virtue", -368.92, 176.25, "LC,Protectorate of Donegal,Alarion Province"], ["Aiguebelle", -384.88, 101.54, "LC,Protectorate of Donegal,Alarion Province"], ["Ayacucho", -403.31, 52.94, "LC,Protectorate of Donegal,Alarion Province"], ["Chiavenna", -380.52, 88.36, "LC,Protectorate of Donegal,Alarion Province"], ["Mercedes", -392.71, 112.14, "LC,Protectorate of Donegal,Alarion Province"], ["Venaria", -396.07, 83.96, "LC,Protectorate of Donegal,Alarion Province"], ["Binyang", -370.41, 21.41, "LC,Protectorate of Donegal,Alarion Province"], ["Inchicore", -362.37, 7.44, "LC,Protectorate of Donegal,Alarion Province"], ["Valloire", -384.1, 39.9, "LC,Protectorate of Donegal,Alarion Province"], ["Finsterwalde", -289.83, 17.8, "LC,Protectorate of Donegal,Alarion Province"], ["Rosice", -279.22, 52.94, "LC,Protectorate of Donegal,Alarion Province"], ["Sierpc", -288.27, 43.93, "LC,Protectorate of Donegal,Alarion Province"], ["Buena", -400.43, 35.63, "LC,Protectorate of Donegal,Alarion Province"], ["Alula Borealis", -259.0, -54.08, "FWL"], ["Bella I", -259.29, -44.25, "FWL"], ["Cascade", -223.12, -47.61, "FWL"], ["Colfax", -232.93, -49.16, "FWL"], ["Dalcour", -384.88, -99.56, "FWL"], ["McAffe", -181.19, -45.28, "FWL"], ["Megrez", -211.22, -41.92, "FWL"], ["Nestor", -170.58, -25.9, "FWL"], ["Pingree", -201.61, -64.93, "FWL"], ["Sheridan (FWL)", -178.91, -56.92, "FWL"], ["Thermopolis", -215.38, -58.21, "FWL"], ["Togwotee", -196.45, -48.9, "FWL"], ["Trellisane", -251.26, -55.11, "FWL"], ["Cerillos", -369.9, -81.21, "FWL"], ["Epsilon", -316.18, -59.5, "FWL"], ["Galisteo", -355.93, -71.91, "FWL"], ["Griffith", -333.73, -76.56, "FWL"], ["Nockatunga", -289.03, -54.08, "FWL"], ["Promised Land", -304.3, -72.42, "FWL"], ["Caledonia", -121.03, 37.18, "LC,Federation of Skye,Rahneshire"], ["Solaris", -122.32, -7.03, "LC,Federation of Skye,Rahneshire"], ["Dixie", -253.84, -21.25, "LC,Protectorate of Donegal,Bolan Province"], ["Loric", -230.35, -38.82, "LC,Protectorate of Donegal,Bolan Province"], ["Zwenkau", -233.72, 9.77, "LC,Protectorate of Donegal,Bolan Province"], ["Abramkovo", -330.86, -28.74, "LC,Protectorate of Donegal,Alarion Province"], ["Zdice", -311.95, -24.36, "LC,Protectorate of Donegal,Alarion Province"], ["Pencader", -350.49, -52.77, "LC,Protectorate of Donegal,Alarion Province"], ["Penobscot", -332.94, -45.8, "LC,Protectorate of Donegal,Alarion Province"], ["Timbiqui", -333.73, -59.24, "LC,Protectorate of Donegal,Alarion Province"], ["Arganda", -154.82, 36.14, "LC,Protectorate of Donegal,Bolan Province"], ["Fianna", -141.44, 20.63, "LC,Federation of Skye,Rahneshire"], ["Lamon", -132.33, 33.3, "LC,Federation of Skye,Rahneshire"], ["Rahne", -141.93, 9.28, "LC,Federation of Skye,Rahneshire,Minor Capital"], ["Sarpsborg", -149.67, 32.26, "LC,Protectorate of Donegal,Bolan Province"], ["Arcadia (LC)", -186.34, -8.06, "LC,Protectorate of Donegal,Bolan Province"], ["Dar-es-Salaam", -194.87, 13.39, "LC,Protectorate of Donegal,Bolan Province"], ["Eilenburg", -220.24, 19.34, "LC,Protectorate of Donegal,Bolan Province"], ["Ford", -191.3, -29.51, "LC,Protectorate of Donegal,Bolan Province"], ["Giausar", -207.85, -26.41, "LC,Protectorate of Donegal,Bolan Province"], ["Gienah", -183.07, -12.97, "LC,Protectorate of Donegal,Bolan Province"], ["Hyde", -162.36, 2.54, "LC,Protectorate of Donegal,Bolan Province"], ["Launam", -167.21, -12.46, "LC,Protectorate of Donegal,Bolan Province"], ["Mariefred", -180.2, 25.54, "LC,Protectorate of Donegal,Bolan Province"], ["Senftenberg", -208.84, 7.96, "LC,Protectorate of Donegal,Bolan Province"], ["Cavanaugh II", -307.13, -52.56, "LC,Protectorate of Donegal,Alarion Province"], ["Commonwealth Mining Outpost 26 (Gulf Breeze 3057+)", -304.29, 203.39, "LC,Protectorate of Donegal,Coventry Province"], ["Loxley", -312.32, 224.06, "LC,Protectorate of Donegal,Coventry Province"], ["Richvale", -275.84, 175.21, "LC,Protectorate of Donegal,Coventry Province"], ["Storfors", -312.33, 201.06, "LC,Protectorate of Donegal,Coventry Province"], ["Blumenort", -208.84, 296.45, "LC,Protectorate of Donegal,Coventry Province"], ["Brooloo", -267.03, 284.56, "LC,Protectorate of Donegal,Coventry Province"], ["Gatineau", -242.45, 296.96, "LC,Protectorate of Donegal,Coventry Province"], ["Ludwigshafen", -242.75, 281.97, "LC,Protectorate of Donegal,Coventry Province"], ["Mahone", -232.94, 307.05, "LC,Protectorate of Donegal,Coventry Province"], ["Miquelon", -285.86, 300.84, "LC,Protectorate of Donegal,Coventry Province"], ["Mississauga", -224.91, 294.64, "LC,Protectorate of Donegal,Coventry Province"], ["Timehri", -261.08, 297.22, "LC,Protectorate of Donegal,Coventry Province"], ["Abbadiyah", -317.97, 246.55, "LC,Protectorate of Donegal,Coventry Province"], ["Australia", -304.3, 289.47, "LC,Protectorate of Donegal,Coventry Province"], ["Ellengurg", -297.55, 259.48, "LC,Protectorate of Donegal,Coventry Province"], ["Guatavita", -286.45, 238.03, "LC,Protectorate of Donegal,Coventry Province"], ["Recife", -286.66, 274.22, "LC,Protectorate of Donegal,Coventry Province"], ["Windsor", -277.14, 274.99, "LC,Protectorate of Donegal,Coventry Province"], ["Biuque", -223.12, 245.01, "LC,Protectorate of Donegal,Coventry Province"], ["Goetville", -261.37, 263.88, "LC,Protectorate of Donegal,Coventry Province"], ["Incukalns", -201.11, 212.95, "LC,Protectorate of Donegal,Coventry Province"], ["Krievci", -225.4, 227.17, "LC,Protectorate of Donegal,Coventry Province"], ["New Capetown", -252.06, 260.77, "LC,Protectorate of Donegal,Coventry Province"], ["Santana", -198.83, 258.45, "LC,Protectorate of Donegal,Coventry Province"], ["Sargasso", -216.87, 268.27, "LC,Protectorate of Donegal,Coventry Province"], ["Timkovichi", -198.25, 246.04, "LC,Protectorate of Donegal,Coventry Province"], ["Tsinan", -243.24, 206.49, "LC,Protectorate of Donegal,Coventry Province"], ["Wrociaw", -211.22, 240.61, "LC,Protectorate of Donegal,Coventry Province"], ["Greenlaw", -227.47, 159.44, "LC,Protectorate of Donegal,Coventry Province"], ["Horneburg", -225.39, 166.94, "LC,Protectorate of Donegal,Coventry Province"], ["Pobeda", -244.82, 189.17, "LC,Protectorate of Donegal,Coventry Province"], ["Saravan", -274.27, 186.07, "LC,Protectorate of Donegal,Coventry Province"], ["Upano", -219.45, 192.28, "LC,Protectorate of Donegal,Coventry Province"], ["Vorzel", -235.01, 180.13, "LC,Protectorate of Donegal,Coventry Province"], ["Eutin", -222.82, 150.13, "LC,Protectorate of Donegal,Coventry Province"], ["Baryshevo", -350.49, 235.44, "LC,Protectorate of Donegal,Coventry Province"], ["Ewanrigg", -330.86, 287.4, "LC,Protectorate of Donegal,Coventry Province"], ["Khartoum", -328.78, 273.96, "LC,Protectorate of Donegal,Coventry Province"], ["Millerton", -343.25, 285.33, "LC,Protectorate of Donegal,Coventry Province"], ["Nouasseur", -351.27, 262.32, "LC,Protectorate of Donegal,Coventry Province"], ["Qarahta", -336.02, 226.91, "LC,Protectorate of Donegal,Coventry Province"], ["Tangua", -307.36, 271.89, "LC,Protectorate of Donegal,Coventry Province"], ["Zwipadze", -338.39, 262.58, "LC,Protectorate of Donegal,Coventry Province"], ["Chhaprauli", -346.13, 219.42, "LC,Protectorate of Donegal,Coventry Province"], ["Coventry", -257.86, 221.26, "LC,Protectorate of Donegal,Coventry Province,Minor Capital"], ["Alma Alta", -183.57, 186.07, "LC,Protectorate of Donegal,District of Donegal"], ["Cameron (LC)", -172.97, 167.2, "LC,Protectorate of Donegal,District of Donegal"], ["Forkas", -211.23, 159.97, "LC,Protectorate of Donegal,District of Donegal"], ["Gibbs", -201.11, 157.89, "LC,Protectorate of Donegal,District of Donegal"], ["Tetersen", -203.19, 144.71, "LC,Protectorate of Donegal,District of Donegal"], ["Westerstede", -207.55, 170.04, "LC,Protectorate of Donegal,District of Donegal"], ["Pherkad", -142.14, 170.82, "LC,Protectorate of Donegal,District of Donegal"], ["Apostica", -59.71, 155.31, "LC,Protectorate of Donegal,District of Donegal"], ["Aur", -146.8, 134.37, "LC,Protectorate of Donegal,District of Donegal"], ["Breukelen", -88.15, 141.35, "LC,Protectorate of Donegal,District of Donegal"], ["Callisto V", -156.59, 123.8, "LC,Protectorate of Donegal,District of Donegal"], ["Crevedia", -128.47, 160.23, "LC,Protectorate of Donegal,District of Donegal"], ["Enkoping", -136.79, 103.61, "LC,Protectorate of Donegal,District of Donegal"], ["Ginestra", -110.62, 163.32, "LC,Protectorate of Donegal,District of Donegal"], ["Halmyre Deans", -125.88, 98.18, "LC,Protectorate of Donegal,District of Donegal"], ["Hillerod", -128.26, 141.86, "LC,Protectorate of Donegal,District of Donegal"], ["Kockengen", -111.71, 150.4, "LC,Protectorate of Donegal,District of Donegal"], ["Leganes", -77.82, 160.23, "LC,Protectorate of Donegal,District of Donegal"], ["Lucianca", -96.94, 163.32, "LC,Protectorate of Donegal,District of Donegal"], ["Mesa Verde", -136.5, 116.54, "LC,Protectorate of Donegal,District of Donegal"], ["Porrima", -113.99, 139.28, "LC,Protectorate of Donegal,District of Donegal"], ["Svinngarn", -131.83, 110.84, "LC,Protectorate of Donegal,District of Donegal"], ["Veckholm", -116.07, 124.02, "LC,Protectorate of Donegal,District of Donegal"], ["Chaffee (LC)", -95.4, 82.42, "LC,Federation of Skye,Virginia Shire"], ["Laurieston", -106.56, 93.53, "LC,Federation of Skye,Virginia Shire"], ["Nekkar", -93.58, 96.37, "LC,Federation of Skye,Virginia Shire"], ["Whittington", -106.27, 106.46, "LC,Federation of Skye,Virginia Shire"], ["Accrington", -10.09, 144.97, "LC,Federation of Skye,Virginia Shire"], ["Auldhouse", -51.01, 139.2, "LC,Federation of Skye,Virginia Shire"], ["Dalkeith", -26.4, 157.71, "LC,Federation of Skye,Virginia Shire"], ["Eaglesham", -33.35, 134.63, "LC,Federation of Skye,Virginia Shire"], ["Phalan", -19.91, 134.37, "LC,Federation of Skye,Virginia Shire"], ["Port Moseby", 3.35, 160.22, "LC,Federation of Skye,Virginia Shire"], ["Sakhalin (LC)", -24.04, 151.69, "LC,Federation of Skye,Virginia Shire"], ["Symington", -38.52, 147.81, "LC,Federation of Skye,Virginia Shire"], ["Alexandria (LC)", -57.64, 115.99, "LC,Federation of Skye,Virginia Shire,Minor Capital"], ["Carstairs", -77.04, 139.28, "LC,Federation of Skye,Virginia Shire"], ["Eaton", -80.92, 112.66, "LC,Federation of Skye,Virginia Shire"], ["Edasich", -96.42, 120.66, "LC,Federation of Skye,Virginia Shire"], ["Kirkcaldy", -96.42, 127.13, "LC,Federation of Skye,Virginia Shire"], ["Yed Prior", -62.04, 124.02, "LC,Federation of Skye,Virginia Shire"], ["Ganshoren", -43.43, 158.15, "LC,Tamar Pact,Tamar Domains"], ["Tharkad", -213.0, 151.77, "LC,Protectorate of Donegal,District of Donegal,Faction Capital"], ["Donegal", -182.41, 159.29, "LC,Protectorate of Donegal,District of Donegal,Major Capital"], ["Freedom", -64.28, 107.74, "LC,Federation of Skye,Virginia Shire"], ["Adelaide", -250.47, 315.32, "LC,Protectorate of Donegal,Coventry Province"], ["Anembo", -288.73, 314.79, "LC,Protectorate of Donegal,Coventry Province"], ["Mandaoaaru", -304.99, 307.56, "LC,Protectorate of Donegal,Coventry Province"], ["Zhongshan", -206.56, 323.33, "LC,Protectorate of Donegal,Coventry Province"], ["Annunziata", -240.17, 358.74, "LC,Protectorate of Donegal,Coventry Province"], ["Chapultepec", -240.36, 343.49, "LC,Protectorate of Donegal,Coventry Province"], ["Hood IV", -269.11, 369.34, "LC,Protectorate of Donegal,Coventry Province"], ["Jesenice", -266.86, 347.42, "LC,Protectorate of Donegal,Coventry Province"], ["Kowloon", -292.6, 367.02, "LC,Protectorate of Donegal,Coventry Province"], ["Kwangchowwang", -253.35, 333.41, "LC,Protectorate of Donegal,Coventry Province"], ["Machida", -218.16, 337.81, "LC,Protectorate of Donegal,Coventry Province"], ["Medellin", -240.96, 325.14, "LC,Protectorate of Donegal,Coventry Province"], ["Pangkalan", -249.29, 364.97, "LC,Protectorate of Donegal,Coventry Province"], ["Arluna", -281.49, 333.92, "LC,Protectorate of Donegal,Coventry Province"], ["Canal", -377.63, 307.3, "LC,Protectorate of Donegal,Coventry Province"], ["Elume", -372.48, 331.08, "LC,Protectorate of Donegal,Coventry Province"], ["Howick", -343.84, 315.83, "LC,Protectorate of Donegal,Coventry Province"], ["Inarcs", -295.18, 337.54, "LC,Protectorate of Donegal,Coventry Province"], ["Jerangle", -318.18, 355.39, "LC,Protectorate of Donegal,Coventry Province"], ["Neerabup", -339.19, 333.67, "LC,Protectorate of Donegal,Coventry Province"], ["Swartklip", -359.8, 329.02, "LC,Protectorate of Donegal,Coventry Province"], ["Trentham", -310.74, 342.97, "LC,Protectorate of Donegal,Coventry Province"], ["Willunga", -333.73, 345.3, "LC,Protectorate of Donegal,Coventry Province"], ["Winter", -299.33, 350.46, "LC,Protectorate of Donegal,Coventry Province"], ["Issaba", -406.39, 265.43, "LC,Protectorate of Donegal,Coventry Province"], ["Krung Thep", -369.61, 235.44, "LC,Protectorate of Donegal,Coventry Province"], ["Kwangjong-ni", -398.54, 281.39, "LC,Protectorate of Donegal,Coventry Province"], ["Lost", -415.29, 252.44, "LC,Protectorate of Donegal,Coventry Province"], ["Ma'anshan", -389.04, 272.66, "LC,Protectorate of Donegal,Coventry Province"], ["Moriguchi", -365.25, 290.25, "LC,Protectorate of Donegal,Coventry Province"], ["Niangol", -374.28, 242.94, "LC,Protectorate of Donegal,Coventry Province"], ["Qanatir", -377.14, 256.9, "LC,Protectorate of Donegal,Coventry Province"], ["Strandfontein", -335.03, 302.91, "LC,Protectorate of Donegal,Coventry Province"], ["Tainjin", -365.05, 273.44, "LC,Protectorate of Donegal,Coventry Province"], ["Tsarahavana", -353.15, 301.61, "LC,Protectorate of Donegal,Coventry Province"], ["Bucklands", -326.2, 330.56, "LC,Protectorate of Donegal,Coventry Province"], ["Melissia", -222.79, 347.0, "LC,Protectorate of Donegal,Coventry Province"], ["Kamenz", -311.15, -4.36, "LC,Protectorate of Donegal,Alarion Province"], ["Alekseyevka", -403.5, 183.74, "LC,Protectorate of Donegal,Alarion Province"], ["Amminadav", -411.25, 199.52, "LC,Protectorate of Donegal,Alarion Province"], ["Champadanga", -381.81, 216.31, "LC,Protectorate of Donegal,Alarion Province"], ["Coldbrook", -421.85, 126.36, "LC,Protectorate of Donegal,Alarion Province"], ["Firenze", -401.73, 134.38, "LC,Protectorate of Donegal,Alarion Province"], ["Halifax", -440.98, 128.94, "LC,Protectorate of Donegal,Alarion Province"], ["Kladnitsa", -414.11, 128.68, "LC,Protectorate of Donegal,Alarion Province"], ["Pocologan", -422.15, 166.16, "LC,Protectorate of Donegal,Alarion Province"], ["Qurayyat", -403.5, 225.1, "LC,Protectorate of Donegal,Alarion Province"], ["Sapienza", -418.48, 145.23, "LC,Protectorate of Donegal,Alarion Province"], ["Wiltshire", -439.2, 143.16, "LC,Protectorate of Donegal,Alarion Province"], ["Aberystwyth", -430.97, 58.63, "LC,Protectorate of Donegal,Alarion Province"], ["Enders Cluster (10)", -447.22, 69.23, "LC,Protectorate of Donegal,Alarion Province"], ["Florida", -426.81, 73.89, "LC,Protectorate of Donegal,Alarion Province"], ["Hinckley", -452.38, 98.7, "LC,Protectorate of Donegal,Alarion Province"], ["Karkkila", -433.74, 90.69, "LC,Protectorate of Donegal,Alarion Province"], ["New India", -458.31, 47.52, "LC,Protectorate of Donegal,Alarion Province"], ["Rapla", -411.54, 83.45, "LC,Protectorate of Donegal,Alarion Province"], ["Stanley", -413.82, 110.85, "LC,Protectorate of Donegal,Alarion Province"], ["Urjala", -417.78, 69.49, "LC,Protectorate of Donegal,Alarion Province"], ["Viborg", -465.25, 80.09, "LC,Protectorate of Donegal,Alarion Province"], ["Al Jafr", -412.83, 12.11, "LC,Protectorate of Donegal,Alarion Province"], ["Biloela", -351.28, -12.71, "LC,Protectorate of Donegal,Alarion Province"], ["Bobruisk", -336.19, -15.48, "LC,Protectorate of Donegal,Alarion Province"], ["Cruz Alta", -436.92, 20.63, "LC,Protectorate of Donegal,Alarion Province"], ["Ilzra", -397.86, 2.29, "LC,Protectorate of Donegal,Alarion Province"], ["Rajkot", -374.56, -21.25, "LC,Protectorate of Donegal,Alarion Province"], ["Revivim", -403.31, 18.31, "LC,Protectorate of Donegal,Alarion Province"], ["Sarikavak", -425.74, 8.29, "LC,Protectorate of Donegal,Alarion Province"], ["Shahr Kord", -431.46, -11.3, "LC,Protectorate of Donegal,Alarion Province"], ["Stantsiya", -392.71, -23.05, "LC,Protectorate of Donegal,Alarion Province"], ["Teyvareb", -413.62, -14.0, "LC,Protectorate of Donegal,Alarion Province"], ["Timbuktu", -446.64, 154.76, "LC,Protectorate of Donegal,Alarion Province"], ["Leximon", -463.23, -207.65, "LL"], ["Lindassa", -475.1, -216.01, "LL"], ["Logan Prime", -484.78, -228.76, "LL"], ["Lordinax", -469.82, -172.91, "LL"], ["Lummatii", -487.19, -205.01, "LL"], ["Lothario", -474.39, -185.73, "LL,Faction Capital"], ["Dersidatz (Blantleff 3025+)", -467.61, -115.77, "LL"], ["Maximillian", -443.07, -126.78, "CF"], ["Hazeldean", -409.26, -165.47, "FWL"], ["Huntington", -395.48, -186.68, "FWL"], ["Landfall", -403.31, -201.64, "FWL"], ["Addhara", -443.66, -293.42, "MH"], ["Algenib", -438.6, -379.18, "MH"], ["Baccalieu", -404.74, -334.76, "MH"], ["Ballalaba", -401.67, -352.79, "MH"], ["Horatius", -439.7, -343.56, "U"], ["Islington", -383.42, -368.84, "MH"], ["Marius's Tears", -468.51, -357.74, "U"], ["New Venice", -470.7, -296.49, "U"], ["Pompey", -430.47, -320.68, "MH"], ["Stafford", -422.99, -306.61, "MH"], ["Suetonius", -405.19, -317.39, "MH"], ["Valerius", -452.99, -154.24, "U"], ["Alphard (MH)", -406.23, -298.44, "MH,Faction Capital"], ["Reykavis", -418.98, -200.61, "IP"], ["Trasjkis", -434.35, -191.9, "IP"], ["Trondheimal", -424.26, -187.77, "IP"], ["Illyria", -439.23, -178.11, "IP,Faction Capital"], ["Claybrooke", -51.97, -369.15, "FWL"], ["Thurrock", -74.49, -382.14, "FWL"], ["Addasar", -29.44, -516.52, "MOC"], ["Adhara (Trip 3040+)", -123.31, -468.96, "MOC"], ["Adherlwin", -134.3, -418.68, "MOC"], ["Afarsin", -216.31, -369.87, "MOC"], ["Bass", -218.51, -353.6, "MOC"], ["Bethonolog", -187.95, -358.0, "MOC"], ["Booker", -237.65, -357.78, "MOC"], ["Borgan's Rift", -105.06, -412.09, "MOC"], ["Brixtana", -91.65, -450.12, "MOC"], ["Candiear", -203.78, -419.34, "MOC"], ["Cate's Hold", -69.56, -471.67, "MOC"], ["Dainmar Majoris", -62.2, -484.2, "MOC"], ["Dunianshire", -77.81, -498.05, "MOC"], ["Early Dawn", -92.97, -428.58, "MOC"], ["Fanardir", -118.03, -398.68, "MOC"], ["Gallis", -173.66, -380.43, "MOC"], ["Gambilon", -263.59, -382.84, "MOC"], ["Hardcore", -198.28, -473.21, "MOC"], ["Harminous", -185.97, -444.4, "MOC"], ["Joyz", -135.4, -448.37, "MOC"], ["Kossandra's Memory", -232.15, -474.75, "A"], ["Krimari", -162.23, -439.35, "MOC"], ["Lindenmarle", -206.2, -384.38, "MOC"], ["Lockton", -134.3, -433.41, "MOC"], ["Luxen", -102.54, -493.87, "MOC"], ["Marantha", -248.42, -368.99, "MOC"], ["Megarez", -172.34, -411.21, "MOC"], ["New Abilene", -71.64, -450.56, "MOC"], ["Novo Tressida", -172.35, -493.21, "MOC"], ["Palladix", -241.38, -409.23, "MOC"], ["Palm", -101.77, -469.91, "MOC"], ["Royal Foxx", -196.31, -395.38, "MOC"], ["Tarol IV", -229.51, -399.33, "MOC"], ["Techne's Revenge", -231.59, -424.62, "MOC"], ["Trznadel Cluster (60)", -159.79, -458.65, "MOC"], ["Wildwood", -217.63, -440.01, "A"], ["Canopus IV", -147.17, -395.0, "MOC,Faction Capital"], ["Gannett", -165.43, -60.54, "FWL"], ["Gallatin", -160.77, -74.49, "FWL"], ["Uhuru", -139.07, -12.46, "FWL"], ["Tania Australis", -140.65, -64.67, "FWL"], ["Bainsville", -141.44, -83.29, "FWL"], ["Drusibacken", -123.31, -123.64, "FWL"], ["Oceana", -96.42, -108.08, "FWL"], ["Autumn Wind", -167.51, -87.42, "FWL"], ["Escobas", -216.88, -126.42, "FWL,Duchy of Graham-Marik"], ["Loyalty", -226.68, -144.56, "FWL,Duchy of Graham-Marik"], ["Campbelton", -168.44, -112.09, "FWL,Marik Commonwealth"], ["Dickinson", -146.6, -112.74, "FWL,Marik Commonwealth"], ["Kirkenlaard", -159.98, -121.76, "FWL,Marik Commonwealth"], ["New Olympia", -150.17, -130.29, "FWL,Marik Commonwealth"], ["Tongatapu", -171.25, -141.36, "FWL,Marik Commonwealth"], ["Ariel", -115.77, -98.53, "FWL,Marik Commonwealth"], ["Keystone", -125.09, -105.51, "FWL,Marik Commonwealth"], ["Lancaster (FWL)", -115.77, -88.19, "FWL,Marik Commonwealth"], ["Rasalas", -150.76, -93.88, "FWL,Marik Commonwealth"], ["Washburn", -155.32, -103.72, "FWL,Marik Commonwealth"], ["Alterf", -203.99, -154.87, "FWL,Marik Commonwealth"], ["Ionus", -183.57, -152.78, "FWL,Marik Commonwealth"], ["Angell II", -98.23, -84.06, "FWL,Marik Commonwealth"], ["Laureles", -186.06, -126.2, "FWL,Marik Commonwealth"], ["Atreus (FWL)", -191.07, -163.78, "FWL,Marik Commonwealth,Faction Capital"], ["Bondurant", -162.86, -45.28, "FWL,Silver Hawk Coalition"], ["Danais", -148.08, -40.37, "FWL,Silver Hawk Coalition"], ["Amity", -128.96, -30.81, "FWL,Silver Hawk Coalition"], ["Concord", -146.6, -27.97, "FWL,Silver Hawk Coalition"], ["Helm", -133.61, -58.21, "FWL,Stewart Commonality"], ["Merak", -119.44, -62.34, "FWL,Stewart Commonality"], ["Bedeque", -124.59, -77.34, "FWL,Stewart Commonality"], ["Marik", -79.62, -75.28, "FWL,Marik Commonwealth,Major Capital"], ["Blackstone", -123.88, 473.52, "OC"], ["Butte Hold", -100.82, 462.4, "I"], ["Placida", -117.69, 490.79, ""], ["Oberon VI", -111.42, 473.25, "OC,Faction Capital"], ["Dalton", -115.77, -229.9, "FWL"], ["Harsefeld", -17.86, -141.98, "FWL"], ["Ipswich", -48.34, -232.97, "FWL"], ["Kiyev", -88.15, -171.72, "FWL"], ["Kyeinnisan", -100.81, -150.51, "FWL"], ["Mansu-ri", -94.87, -254.18, "FWL"], ["Second Chance", -22.76, -129.79, "FWL"], ["Semenyih", -74.45, -161.61, "FWL"], ["Anegasaki", -49.38, -216.71, "FWL,Duchy of Oriente"], ["Calloway VI", -58.17, -199.57, "FWL,Duchy of Oriente"], ["Daneshmand", -72.12, -181.03, "FWL,Duchy of Oriente"], ["Fujidera", -76.78, -225.44, "FWL,Duchy of Oriente"], ["Jouques", -110.62, -211.76, "FWL,Duchy of Oriente"], ["Les Halles", -39.05, -187.97, "FWL,Duchy of Oriente"], ["Loeches", -74.45, -201.15, "FWL,Duchy of Oriente"], ["Maritgues", -95.92, -213.34, "FWL,Duchy of Oriente"], ["Matheran", -65.66, -170.43, "FWL,Duchy of Oriente"], ["Milnerton", -85.31, -232.47, "FWL,Duchy of Oriente"], ["Salur", -80.14, -195.5, "FWL,Duchy of Oriente"], ["Shenwan", -96.17, -221.87, "FWL,Duchy of Oriente"], ["Carbonis", -47.58, -175.58, "FWL,Duchy of Orloff"], ["Hassad", -29.99, -160.62, "FWL,Duchy of Orloff"], ["Vanra", -48.34, -163.19, "FWL,Duchy of Orloff"], ["Ventabren", 3.35, -123.35, "FWL,Ohren Province"], ["Emris IV", -88.93, -149.42, "FWL,The Protectorate"], ["Fuentes", -72.91, -145.35, "FWL,The Protectorate"], ["McKenna", -66.18, -132.37, "FWL,The Protectorate"], ["New Delos", -38.01, -140.69, "FWL,The Protectorate"], ["Nova Roma", -83.25, -133.95, "FWL,The Protectorate"], ["Oriente", -76.28, -211.42, "FWL,Duchy of Oriente,Major Capital"], ["Ramgarh", 391.87, 224.84, "DC,Galedon Military District,New Samarkand Prefecture"], ["Kazanka", 444.61, 229.75, "DC,Galedon Military District,Tabayama Prefecture"], ["Pondicherry", 401.69, 239.06, "DC,Galedon Military District,Tabayama Prefecture"], ["Suianheer", 419.53, 246.55, "DC,Galedon Military District,Tabayama Prefecture"], ["Zlatousi", 427.28, 219.67, "DC,Galedon Military District,Tabayama Prefecture"], ["Tabayama", 407.56, 233.1, "DC,Galedon Military District,Tabayama Prefecture,Minor Capital"], ["Kennard", 468.64, 88.35, "FS,Draconis March,Woodbine Operational Area,Bryceland PDZ"], ["Pajarito", 479.75, 77.24, "FS,Draconis March,Woodbine Operational Area,Bryceland PDZ"], ["Pitkin", 492.68, 76.98, "FS,Draconis March,Woodbine Operational Area,Bryceland PDZ"], ["Jordan Wais", 496.8, 177.27, "OA,Alpheratz Province"], ["Loparri", 528.0, 125.03, "OA,Alpheratz Province"], ["Mitchella", 481.01, 141.72, "OA,Alpheratz Province"], ["Praxton", 547.41, 131.74, "OA,Alpheratz Province"], ["Quatre Belle", 481.37, 156.41, "OA,Alpheratz Province"], ["Rudolpho", 533.99, 156.59, "OA,Alpheratz Province"], ["Coraines", 489.55, 196.5, "OA,Cerberus Province"], ["Dneiper", 465.05, 244.22, "OA,Cerberus Province"], ["Milligan's World", 450.54, 217.36, "OA,Cerberus Province"], ["Prinis Prime", 473.22, 233.33, "OA,Cerberus Province"], ["Quantraine", 455.62, 205.21, "OA,Cerberus Province"], ["Risin", 483.56, 225.89, "OA,Cerberus Province"], ["Rushaven", 473.58, 211.02, "OA,Cerberus Province"], ["Cerberus", 475.84, 190.47, "OA,Cerberus Province,Major Capital"], ["Alegro", 429.84, 144.62, "OA,Ramora Province"], ["Banori", 494.25, 124.12, "OA,Ramora Province"], ["Brasha", 436.57, 194.87, "OA,Ramora Province"], ["Calish", 457.6, 159.59, "OA,Ramora Province"], ["Crestoblus", 452.16, 102.53, "OA,Ramora Province"], ["Dante", 427.86, 175.12, "OA,Ramora Province"], ["Dindatari", 438.55, 159.68, "OA,Ramora Province"], ["Dormandaine", 462.32, 100.73, "OA,Ramora Province"], ["Kinkaid II", 440.55, 122.49, "OA,Ramora Province"], ["Lushann", 449.62, 140.81, "OA,Ramora Province"], ["Mishkadrill", 509.84, 86.02, "OA,Ramora Province"], ["Morthac", 442.74, 174.36, "OA,Ramora Province"], ["Quiberas", 467.77, 174.0, "OA,Ramora Province"], ["Sevon", 465.54, 132.82, "OA,Ramora Province"], ["Tellman IV", 537.14, 98.18, "OA,Ramora Province"], ["Ramora", 491.3, 99.05, "OA,Ramora Province,Major Capital"], ["Alpheratz", 502.79, 152.9, "OA,Alpheratz Province,Faction Capital"], ["Crellacor", -82.87, 469.85, "OC"], ["Drask's Den", -86.54, 489.18, "OC"], ["Gustrell", -66.62, 466.65, "OC"], ["Paulus Prime", -73.04, 480.16, "OC"], ["The Rock", -82.2, 500.49, "OC"], ["Hunter's Paradise", -599.96, 133.61, "A"], ["All Dawn", -459.31, 154.02, "I"], ["Gillfillan's Gold", -475.37, 113.18, "I"], ["Otisberg", -486.47, 125.07, ""], ["Waypoint", -489.18, 183.06, ""], ["Able's Glory", -539.27, 124.69, "U"], ["Moroney", -493.12, 155.73, "U"], ["Bayindir", -242.75, -296.3, "FWL"], ["Bismarck", -245.32, -264.98, "FWL"], ["Gatchina", -270.89, -295.21, "FWL"], ["Ghaziabad", -307.67, -237.62, "FWL"], ["Goth Khakar", -332.45, -244.56, "FWL"], ["Karachi", -292.4, -243.28, "FWL"], ["Mankova", -253.06, -272.02, "FWL"], ["Romita", -354.15, -252.09, "FWL"], ["Tellman's Mistake", -243.53, -310.77, "FWL"], ["Campoleone", -299.83, -291.84, "FWL,Rim Commonality"], ["Negushevo", -286.95, -273.8, "FWL,Rim Commonality"], ["Tematagi", -270.9, -266.56, "FWL,Rim Commonality"], ["Tohelet", -292.89, -263.99, "FWL,Rim Commonality"], ["Astrokaszy", -290.63, -315.41, "I"], ["Lesnovo", -315.4, -266.86, "FWL,Rim Commonality"], ["Constance", 100.03, 429.05, "DC,Rasalhague Military District,Trondheim Prefecture"], ["Idlewind", 123.55, 429.05, "DC,Rasalhague Military District,Trondheim Prefecture"], ["Jarett", 102.17, 415.15, "DC,Rasalhague Military District,Trondheim Prefecture"], ["Polcenigo", 109.07, 374.8, "DC,Rasalhague Military District,Trondheim Prefecture"], ["Richmond", 130.78, 455.45, "DC,Rasalhague Military District,Trondheim Prefecture"], ["Alleghe", -9.84, 406.05, "DC,Rasalhague Military District,Kirchbach Prefecture"], ["Balsta", 28.94, 412.77, "DC,Rasalhague Military District,Radstadt Prefecture"], ["Damian", 72.89, 459.29, "DC,Rasalhague Military District,Kirchbach Prefecture"], ["Dawn", 29.19, 375.29, "DC,Rasalhague Military District,Radstadt Prefecture"], ["Hermagor", 23.76, 388.98, "DC,Rasalhague Military District,Radstadt Prefecture"], ["Holmsbu", 57.67, 441.91, "DC,Rasalhague Military District,Kirchbach Prefecture"], ["Jezersko", 88.13, 369.88, "DC,Rasalhague Military District,Trondheim Prefecture"], ["Last Frontier", 80.12, 387.98, "DC,Rasalhague Military District,Trondheim Prefecture"], ["Leoben", 41.35, 405.27, "DC,Rasalhague Military District,Radstadt Prefecture"], ["New Bergen", 19.38, 402.95, "DC,Rasalhague Military District,Radstadt Prefecture"], ["New Oslo", 15.25, 386.15, "DC,Rasalhague Military District,Radstadt Prefecture"], ["Outpost", 15.25, 426.47, "DC,Rasalhague Military District,Kirchbach Prefecture"], ["Pinnacle", 71.84, 430.89, "DC,Rasalhague Military District,Trondheim Prefecture"], ["Pomme De Terre", 56.33, 362.88, "DC,Rasalhague Military District,Radstadt Prefecture"], ["Radlje", 57.63, 376.84, "DC,Rasalhague Military District,Radstadt Prefecture"], ["Skallevoll", 37.29, 435.92, "DC,Rasalhague Military District,Kirchbach Prefecture"], ["St. John", -13.45, 400.87, "DC,Rasalhague Military District,Kirchbach Prefecture"], ["Susquehanna", 52.2, 420.52, "DC,Rasalhague Military District,Radstadt Prefecture"], ["Svelvik", 17.31, 411.47, "DC,Rasalhague Military District,Kirchbach Prefecture"], ["Thule", 93.06, 455.16, "DC,Rasalhague Military District,Kirchbach Prefecture"], ["Vipaava", 61.26, 370.63, "DC,Rasalhague Military District,Radstadt Prefecture"], ["Rasalhague", 39.28, 389.77, "DC,Rasalhague Military District,Radstadt Prefecture,Major Capital"], ["Courchevel", 95.11, 344.79, "DC,Rasalhague Military District,Trondheim Prefecture"], ["Kaesong", 59.69, 296.71, "DC,Rasalhague Military District,Alshain Prefecture"], ["Marawi", 62.28, 264.91, "DC,Rasalhague Military District,Alshain Prefecture"], ["Sheliak", 64.36, 289.99, "DC,Rasalhague Military District,Alshain Prefecture"], ["Soverzene", 87.1, 317.15, "DC,Rasalhague Military District,Alshain Prefecture"], ["Thessalonika", 74.18, 304.71, "DC,Rasalhague Military District,Alshain Prefecture"], ["Tinaca", 70.58, 273.72, "DC,Rasalhague Military District,Alshain Prefecture"], ["Mualang", 96.41, 265.68, "DC,Pesht Military District,Kagoshima Prefecture"], ["Casere", 77.8, 343.74, "DC,Rasalhague Military District,Alshain Prefecture"], ["Engadin", 19.9, 336.51, "DC,Rasalhague Military District,Radstadt Prefecture"], ["Ferleiten", 25.32, 353.84, "DC,Rasalhague Military District,Radstadt Prefecture"], ["Goito", 44.71, 332.89, "DC,Rasalhague Military District,Radstadt Prefecture"], ["Kempten", 45.22, 308.08, "DC,Rasalhague Military District,Radstadt Prefecture"], ["Predlitz", 43.68, 354.61, "DC,Rasalhague Military District,Radstadt Prefecture"], ["Spittal", 59.18, 344.53, "DC,Rasalhague Military District,Radstadt Prefecture"], ["Stanzach", 14.46, 315.83, "DC,Rasalhague Military District,Radstadt Prefecture"], ["Vorarlberg", 24.3, 303.68, "DC,Rasalhague Military District,Radstadt Prefecture"], ["Gunzburg", 12.4, 290.25, "DC,Rasalhague Military District,Radstadt Prefecture"], ["Alshain", 58.34, 278.85, "DC,Rasalhague Military District,Alshain Prefecture,Minor Capital"], ["Ardoz", 46.26, 245.78, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Eguilles", 37.21, 233.12, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Setubal", 44.19, 237.52, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Toffen", 41.61, 221.74, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Rubigen", 30.49, 217.86, "DC,Rasalhague Military District,Rubigen Prefecture,Minor Capital"], ["Krenice", 56.86, 230.27, "DC,Rasalhague Military District,Alshain Prefecture"], ["Mannedorf", 49.1, 226.91, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Sternwerde", 63.83, 248.63, "DC,Rasalhague Military District,Alshain Prefecture"], ["Al Hillah", -25.37, 178.71, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Altenmarkt", 13.69, 223.81, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Dehgolan", 5.43, 199.0, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Diosd", -2.34, 230.53, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Grumium", -4.92, 186.85, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Halesowen", 36.44, 251.73, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Karbala", -23.78, 196.67, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Lothan", -9.84, 220.71, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Maule", 31.79, 245.26, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Nox", 13.18, 239.83, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Orestes", -26.12, 167.59, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Ramsau", -0.27, 222.52, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Satalice", 5.94, 260.77, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Ueda", -14.04, 207.93, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Utrecht", 23.51, 236.47, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Skandia", 22.74, 251.47, "DC,Rasalhague Military District,Rubigen Prefecture"], ["Camlann (FWL)", -153.87, -233.88, "FWL"], ["Futuna", -209.63, -190.85, "FWL"], ["Ibarra", -253.05, -182.02, "FWL"], ["Katlehong", -217.66, -252.1, "FWL"], ["Newcastle", -208.64, -180.74, "FWL"], ["Norfolk", -221.83, -179.94, "FWL"], ["Nullarbor", -158.49, -250.31, "FWL"], ["Trinidad", -226.98, -172.21, "FWL"], ["Tuamotu", -235.21, -185.69, "FWL"], ["Clipperton", -248.98, -204.52, "FWL,Principality of Gibson"], ["Molokai", -256.22, -194.22, "FWL,Principality of Gibson"], ["Ankolika", -217.17, -221.27, "FWL,Principality of Regulus"], ["Atsugi", -201.11, -227.22, "FWL,Principality of Regulus"], ["Avior", -116.87, -163.19, "FWL,Principality of Regulus"], ["Cameron (FWL)", -157.7, -196.79, "FWL,Principality of Regulus"], ["Ellsworth", -210.43, -239.71, "FWL,Principality of Regulus"], ["Faleolo", -188.22, -200.36, "FWL,Principality of Regulus"], ["Harmony", -141.64, -170.62, "FWL,Principality of Regulus"], ["Hellos Minor", -185.48, -180.97, "FWL,Principality of Regulus"], ["Hongqiao", -227.18, -232.67, "FWL,Principality of Regulus"], ["Muscida", -139.56, -182.32, "FWL,Principality of Regulus"], ["Ngake", -173.95, -198.58, "FWL,Principality of Regulus"], ["Tiber (FWL)", -123.8, -147.43, "FWL,Principality of Regulus"], ["Wallis", -198.83, -193.62, "FWL,Principality of Regulus"], ["Diass", -171.38, -256.95, "FWL,Regulan Free States"], ["Olafsvik", -176.53, -239.11, "FWL,Regulan Free States"], ["Vosloorus", -198.53, -255.67, "FWL,Regulan Free States"], ["Regulus", -152.07, -180.02, "FWL,Principality of Regulus,Major Capital"], ["Ascella", 20.93, 74.4, "DC,Dieron Military District,Al Na'ir Prefecture"], ["Kuzuu", 23.01, 66.62, "DC,Dieron Military District,Al Na'ir Prefecture"], ["Altais", 37.22, 109.81, "DC,Dieron Military District,Algedi Prefecture"], ["Alya", 26.36, 96.63, "DC,Dieron Military District,Algedi Prefecture"], ["Kaus Borealis", 11.37, 96.37, "DC,Dieron Military District,Algedi Prefecture"], ["Alrakis", -19.91, 81.89, "DC,Dieron Military District,Kessel Prefecture"], ["Konstance", -20.17, 96.37, "DC,Dieron Military District,Kessel Prefecture"], ["Dromini VI", -20.94, 66.12, "DC,Dieron Military District,Kessel Prefecture"], ["Kaus Australis", 5.68, 83.45, "DC,Dieron Military District,Kessel Prefecture"], ["Kaus Media", 7.75, 80.09, "DC,Dieron Military District,Kessel Prefecture"], ["Kessel", -13.14, 83.71, "DC,Dieron Military District,Kessel Prefecture,Minor Capital"], ["Cebalrai", -8.29, 119.38, "DC,Dieron Military District,Vega Prefecture"], ["Tsukude", 20.15, 119.37, "DC,Dieron Military District,Vega Prefecture"], ["Alnasi", 2.84, 116.02, "DC,Dieron Military District,Vega Prefecture"], ["Eltanin", -1.92, 99.35, "DC,Dieron Military District,Vega Prefecture"], ["New Wessex", -12.42, 113.43, "DC,Dieron Military District,Vega Prefecture"], ["Dyev", 5.68, 40.8, "DC,Dieron Military District,Kessel Prefecture"], ["Lambrecht", 13.44, 57.6, "DC,Dieron Military District,Kessel Prefecture"], ["Moore", 5.68, 64.06, "DC,Dieron Military District,Al Na'ir Prefecture"], ["Sabik", -12.68, 57.08, "DC,Dieron Military District,Kessel Prefecture"], ["Imbros III", -2.08, 34.08, "DC,Dieron Military District,Kessel Prefecture"], ["Vega", -3.63, 106.62, "DC,Dieron Military District,Vega Prefecture,Minor Capital"], ["Deneb Algedi", 41.1, 26.06, "DC,Dieron Military District,Al Na'ir Prefecture"], ["Nashira", 47.66, 33.59, "DC,Dieron Military District,Al Na'ir Prefecture"], ["Telos IV", 43.94, 40.27, "DC,Dieron Military District,Al Na'ir Prefecture"], ["Dabih", 59.97, 83.5, "DC,Dieron Military District,Al Na'ir Prefecture"], ["Kervil", 34.12, 45.96, "DC,Dieron Military District,Al Na'ir Prefecture"], ["Albalii", 71.08, 78.53, "DC,Dieron Military District,Ashio Prefecture"], ["Chichibu", 90.47, 74.91, "DC,Dieron Military District,Ashio Prefecture"], ["Halstead Station", 78.06, 43.44, "DC,Dieron Military District,Ashio Prefecture"], ["Piedmont", 79.4, 77.76, "DC,Dieron Military District,Ashio Prefecture"], ["Shimonita", 93.83, 82.42, "DC,Dieron Military District,Ashio Prefecture"], ["Shinonoi", 79.87, 53.98, "DC,Dieron Military District,Ashio Prefecture"], ["Yance I", 69.79, 51.65, "DC,Dieron Military District,Ashio Prefecture"], ["Ashio", 73.57, 66.74, "DC,Dieron Military District,Ashio Prefecture,Minor Capital"], ["Pike IV", 20.15, 39.24, "DC,Dieron Military District,Al Na'ir Prefecture"], ["Styx", 25.84, 25.54, "DC,Dieron Military District,Al Na'ir Prefecture"], ["Nirasaki", 34.38, 19.34, "DC,Dieron Military District,Al Na'ir Prefecture"], ["Saffel", 25.59, 11.85, "FS,Draconis March,Robinson Operational Area,Addicks PDZ"], ["Athenry", 17.57, 30.97, "DC,Dieron Military District,Al Na'ir Prefecture"], ["Rukbat", 42.13, 108.78, "DC,Dieron Military District,Algedi Prefecture"], ["Shitara", 41.61, 87.12, "DC,Dieron Military District,Algedi Prefecture"], ["Al Na'ir", 60.1, 31.24, "DC,Dieron Military District,Al Na'ir Prefecture,Minor Capital"], ["Ancha", 75.47, 36.14, "DC,Dieron Military District,Al Na'ir Prefecture"], ["Biham", 71.85, 36.65, "DC,Dieron Military District,Al Na'ir Prefecture"], ["Sadachbia", 80.6, 35.87, "DC,Dieron Military District,Al Na'ir Prefecture"], ["Galatia III", 90.73, 14.23, "FS,Draconis March,Robinson Operational Area,Kentares PDZ"], ["Scheat", 168.53, 41.83, "DC,Benjamin Military District,Proserpina Prefecture"], ["Proserpina", 158.22, 34.3, "DC,Benjamin Military District,Proserpina Prefecture,Minor Capital"], ["Fellanin II", 132.09, 32.78, "DC,Benjamin Military District,Proserpina Prefecture"], ["Sadalbari", 137.78, 42.86, "DC,Benjamin Military District,Proserpina Prefecture"], ["Quentin", 46.0, 12.36, "FS,Draconis March,Robinson Operational Area,Addicks PDZ"], ["Errai", 52.51, 3.48, "FS,Draconis March,Robinson Operational Area,Addicks PDZ"], ["Helen", 57.45, 10.03, "FS,Draconis March,Robinson Operational Area,Addicks PDZ"], ["Addicks", 71.44, -0.7, "FS,Draconis March,Robinson Operational Area,Addicks PDZ"], ["Murchison", 74.7, 19.86, "DC,Dieron Military District,Ashio Prefecture"], ["Towne", 69.27, 7.96, "FS,Draconis March,Robinson Operational Area,Addicks PDZ"], ["Mallory's World", 111.4, 5.9, "FS,Draconis March,Robinson Operational Area,Kentares PDZ"], ["Mara", 121.75, 8.74, "FS,Draconis March,Robinson Operational Area,Kentares PDZ"], ["Cylene", 105.98, 25.03, "DC,Dieron Military District,Ashio Prefecture"], ["Markab", 97.7, 22.76, "DC,Dieron Military District,Ashio Prefecture"], ["Skat", 93.31, 26.83, "DC,Dieron Military District,Ashio Prefecture"], ["David", 140.09, 19.23, "FS,Draconis March,Robinson Operational Area,Raman PDZ"], ["Small World", 51.69, -7.03, "CC,Tikonov Commonality,Region 3"], ["Northwind", 34.12, -2.89, "FS,Draconis March,Robinson Operational Area,Addicks PDZ"], ["Ozawa", 84.78, 2.8, "FS,Draconis March,Robinson Operational Area,Addicks PDZ"], ["Angol", 87.88, -38.82, "FS,Draconis March,Robinson Operational Area,Kentares PDZ"], ["Caselton", 115.47, -32.67, "FS,Draconis March,Robinson Operational Area,Kentares PDZ"], ["Alrescha", 84.52, -49.42, "CC,Tikonov Commonality,Region 7"], ["Yangtze", 75.47, -43.93, "CC,Tikonov Commonality,Region 6"], ["Ankaa", 74.7, -9.36, "FS,Draconis March,Robinson Operational Area,Addicks PDZ"], ["Hean", 74.7, -14.52, "FS,Draconis March,Robinson Operational Area,Addicks PDZ"], ["Mirach", 108.82, -26.93, "FS,Draconis March,Robinson Operational Area,Kentares PDZ"], ["New Rhodes III", 102.36, -15.82, "FS,Draconis March,Robinson Operational Area,Kentares PDZ"], ["Schedar", 117.86, -21.25, "FS,Draconis March,Robinson Operational Area,Kentares PDZ"], ["Tigress", 74.7, -29.51, "CC,Tikonov Commonality,Region 6"], ["Basalt", 66.16, -29.0, "FS,Draconis March,Robinson Operational Area,Addicks PDZ"], ["Deneb Kaitos", 64.62, -12.97, "FS,Draconis March,Robinson Operational Area,Addicks PDZ"], ["Kawich", 53.76, -29.51, "FS,Draconis March,Robinson Operational Area,Addicks PDZ"], ["Nopah", 57.12, -33.65, "FS,Draconis March,Robinson Operational Area,Addicks PDZ"], ["Ruchbah", 57.38, -22.79, "FS,Draconis March,Robinson Operational Area,Addicks PDZ"], ["Rio", 95.38, -28.74, "FS,Draconis March,Robinson Operational Area,Kentares PDZ"], ["Fletcher (CC)", 46.78, -23.57, "CC,Tikonov Commonality,Region 3"], ["Ingress", 49.62, -18.66, "CC,Tikonov Commonality,Region 3"], ["Sheratan", 40.84, -21.51, "CC,Tikonov Commonality,Region 3"], ["Achernar", 77.29, -32.36, "CC,Tikonov Commonality,Region 6"], ["Bharat", 58.93, -41.67, "CC,Tikonov Commonality,Region 6"], ["Hamal", 64.88, -43.47, "CC,Tikonov Commonality,Region 6"], ["Ronel", 95.64, -2.64, "CC,Tikonov Commonality,Region 6"], ["Tybalt", 89.95, -20.47, "CC,Tikonov Commonality,Region 6"], ["Tikonov", 102.84, -42.22, "CC,Tikonov Commonality,Region 7,Major Capital"], ["Kimball II", -35.68, 99.73, "DC,Dieron Military District,Kessel Prefecture"], ["Glengarry", -76.78, 76.98, "LC,Federation of Skye,Virginia Shire"], ["Zebeneschamali", -77.81, 90.17, "LC,Federation of Skye,Virginia Shire"], ["Zebebelgenubi", -52.22, 47.52, "LC,Federation of Skye,Isle of Skye"], ["Carnwath", -63.08, 82.42, "LC,Federation of Skye,Virginia Shire"], ["Izar", -59.98, 97.4, "LC,Federation of Skye,Virginia Shire"], ["Ryde", -45.36, 91.72, "LC,Federation of Skye,Virginia Shire"], ["Komephoros", -34.13, 91.97, "DC,Dieron Military District,Kessel Prefecture"], ["Skondia", -31.8, 55.53, "LC,Federation of Skye,Isle of Skye"], ["Kochab", -68.25, 62.5, "LC,Federation of Skye,Virginia Shire"], ["Seginus", -82.36, 62.77, "LC,Federation of Skye,Virginia Shire"], ["Gladius", -95.91, 71.81, "LC,Federation of Skye,Virginia Shire"], ["Baxter", -31.29, 112.66, "LC,Federation of Skye,Virginia Shire"], ["Corridan IV", -38.01, 121.45, "LC,Federation of Skye,Virginia Shire"], ["Yed Posterior", -44.21, 119.12, "LC,Federation of Skye,Virginia Shire"], ["Marfik", -40.6, 97.66, "D"], ["Alkalurops", -35.94, 45.19, "LC,Federation of Skye,Isle of Skye"], ["Alphecca", -46.79, 61.99, "LC,Federation of Skye,Isle of Skye"], ["Atria", -16.03, 51.65, "DC,Dieron Military District,Kessel Prefecture"], ["Ko", -18.11, 43.9, "DC,Dieron Military District,Kessel Prefecture"], ["La Blon", -31.8, 72.85, "LC,Federation of Skye,Isle of Skye"], ["Lyons", -23.01, 38.73, "LC,Federation of Skye,Isle of Skye"], ["Nusakan", -34.77, 43.29, "LC,Federation of Skye,Isle of Skye"], ["Unukalhai", -46.27, 69.75, "LC,Federation of Skye,Isle of Skye"], ["Skye", -57.01, 51.38, "LC,Federation of Skye,Isle of Skye,Major Capital"], ["St. Andre", 65.65, -100.65, "CC,Sarna Commonality,Region 1"], ["Styk", 42.13, -97.5, "CC,Sarna Commonality,Region 1"], ["Tsitsang", 51.95, -108.58, "CC,Sarna Commonality,Region 1"], ["Arboris", 43.16, -51.49, "CC,Tikonov Commonality,Region 5"], ["Gan Singh", 41.61, -79.67, "CC,Tikonov Commonality,Region 9"], ["Ningpo", 54.28, -66.74, "CC,Tikonov Commonality,Region 10"], ["Algot", 85.82, -82.77, "FS,Capellan March,Kathil Operational Area,Valexa PDZ"], ["Foochow", 88.92, -97.5, "CC,Sarna Commonality,Region 2"], ["Foot Fall", 94.6, -109.87, "CC,Sarna Commonality,Region 2"], ["Menkar", 90.73, -92.07, "CC,Sarna Commonality,Region 2"], ["Buchlau", 70.05, -68.8, "CC,Tikonov Commonality,Region 7"], ["Palos", 50.7, -124.72, "CC,Sarna Commonality,Region 4"], ["Shipka", 80.12, -110.66, "CC,Sarna Commonality,Region 5"], ["Wei", 63.84, -119.18, "CC,Sarna Commonality,Region 5"], ["New Aragon", 69.54, -88.19, "FS,Capellan March,Kathil Operational Area,Valexa PDZ"], ["Halloran V", 72.89, -77.02, "FS,Capellan March,Kathil Operational Area,Valexa PDZ"], ["Hunan", 71.21, -95.95, "CC,Sarna Commonality,Region 1"], ["Shensi", 53.76, -92.52, "CC,Sarna Commonality,Region 1"], ["Acamar", 39.54, -38.57, "CC,Tikonov Commonality,Region 5"], ["Woodstock", 44.2, -36.75, "CC,Tikonov Commonality,Region 5"], ["Azha", 53.76, -51.49, "CC,Tikonov Commonality,Region 6"], ["Slocum", 58.15, -52.26, "CC,Tikonov Commonality,Region 6"], ["Algol", 64.88, -67.77, "CC,Tikonov Commonality,Region 7"], ["Kansu", 67.72, -59.76, "CC,Tikonov Commonality,Region 7"], ["Pleione", 51.44, -79.67, "CC,Tikonov Commonality,Region 10"], ["Poznan", 62.55, -81.21, "CC,Tikonov Commonality,Region 10"], ["Genoa", 39.03, -59.76, "CC,Tikonov Commonality,Region 9"], ["Cynthiana (Liao 2202+)", 34.29, -68.58, "CC,Tikonov Commonality,Region 9"], ["Elnath", 18.6, -127.21, "CC,Sarna Commonality,Region 3"], ["Second Try", 34.37, -115.81, "CC,Sarna Commonality,Region 2"], ["Yunnah", 27.15, -127.0, "CC,Sarna Commonality,Region 2"], ["Menkalinan", -0.01, -70.62, "FWL"], ["Asuncion", 5.17, -101.64, "FWL,Zion Province"], ["Kyrkbacken", 3.42, -94.3, "FWL,Zion Province"], ["Suzano", 15.76, -114.0, "FWL,Zion Province"], ["Zion", 15.25, -83.29, "FWL,Zion Province"], ["Nanking", 22.74, -51.75, "CC,Tikonov Commonality,Region 5"], ["Hsien", 5.68, -54.33, "CC,Tikonov Commonality,Region 4"], ["Aldebaran", 24.81, -64.41, "CC,Tikonov Commonality,Region 9"], ["Zurich", 20.15, -63.13, "CC,Tikonov Commonality,Region 9"], ["Saiph", 4.64, -68.03, "CC,Tikonov Commonality,Region 8"], ["Tall Trees", 0.77, -66.74, "CC,Tikonov Commonality,Region 8"], ["Ohrensen", -16.29, -121.76, "FWL,Ohren Province"], ["Chisholm (Elgin 2878+)", 1.54, -50.97, "CC,Tikonov Commonality,Region 4"], ["Hall", -13.96, -44.25, "CC,Tikonov Commonality,Region 4"], ["Ibstock", -20.99, -101.91, "FWL"], ["Park Place", -29.47, -110.96, "FWL"], ["Berenson", -13.7, -71.13, "FWL"], ["Bernardo", -21.21, -94.6, "FWL"], ["Wasat", -19.91, -54.59, "FWL"], ["New Canton", 8.27, -72.95, "CC,Tikonov Commonality,Region 8"], ["Savannah", -79.63, -46.57, "FWL"], ["Dieudonne", -75.22, -25.9, "FWL"], ["Acubens", -52.22, -50.72, "FWL"], ["Alphard (FWL)", -65.4, -52.01, "FWL"], ["Bordon", -63.08, -33.39, "FWL"], ["Connaught", -54.29, -40.37, "FWL"], ["Nathan", -67.22, -49.16, "FWL"], ["Remulac", -73.16, -39.34, "FWL"], ["Holt", -49.38, -102.93, "FWL"], ["Abadan", -70.32, -95.95, "FWL,Marik Commonwealth"], ["Avellaneda", -57.65, -82.24, "FWL,Marik Commonwealth"], ["Miaplacidus", -62.56, -56.92, "FWL,Marik Commonwealth"], ["Alkes", -114.78, -30.81, "FWL,Silver Hawk Coalition"], ["Kalidasa", -105.76, -23.05, "FWL,Silver Hawk Coalition"], ["New Hope", -113.19, -32.87, "FWL,Silver Hawk Coalition"], ["Adhafera", -105.28, -51.23, "FWL,Stewart Commonality"], ["Tania Borealis", -106.76, -52.52, "FWL,Stewart Commonality"], ["Stewart", -119.18, -51.94, "FWL,Stewart Commonality,Minor Capital"], ["Talitha", -34.13, -34.69, "FWL"], ["Van Diemen IV", -32.83, -41.67, "FWL"], ["Devil's Rock", -36.19, -15.3, "FWL"], ["Pollux", -31.55, -15.56, "FWL,Sirian Concordat"], ["Hamilton (FWL)", -35.68, -81.31, "FWL,Marik Commonwealth"], ["Augustine", -43.7, -76.82, "FWL,Marik Commonwealth"], ["Castor", -40.43, -16.68, "FWL"], ["Irian", -46.53, -56.4, "FWL"], ["Alkaid", -94.1, 47.0, "LC,Federation of Skye,Virginia Shire"], ["Summer", -44.47, 26.06, "LC,Federation of Skye,Isle of Skye"], ["Rochelle", -113.79, -15.82, "FWL"], ["Shiloh", -88.15, -4.96, "FWL,Silver Hawk Coalition"], ["Alioth", -58.94, 13.91, "LC,Federation of Skye,Isle of Skye"], ["Cor Caroli", -62.3, 15.46, "LC,Federation of Skye,Isle of Skye"], ["Galatea", -53.78, 34.08, "LC,Federation of Skye,Isle of Skye"], ["Menkent", -38.29, 22.95, "LC,Federation of Skye,Isle of Skye"], ["Mizar", -54.55, 20.63, "LC,Federation of Skye,Isle of Skye"], ["Syrma", -57.92, 39.15, "LC,Federation of Skye,Isle of Skye"], ["Laiaka", -100.61, 54.24, "LC,Federation of Skye,Virginia Shire"], ["Algorab", -114.84, 13.77, "LC,Federation of Skye,Rahneshire"], ["Gacrux", -86.5, 10.72, "LC,Federation of Skye,Isle of Skye"], ["New Kyoto", -125.73, 11.81, "LC,Federation of Skye,Rahneshire"], ["Zaniah", -102.6, 7.74, "LC,Federation of Skye,Isle of Skye"], ["Carsphairn", -96.17, 38.99, "LC,Federation of Skye,Isle of Skye"], ["Vindemiatrix", -100.41, 26.39, "LC,Federation of Skye,Isle of Skye"], ["Alcor", -74.71, 28.9, "LC,Federation of Skye,Isle of Skye"], ["Alchiba", -67.73, 1.77, "LC,Federation of Skye,Isle of Skye"], ["Milton", -64.37, 2.8, "LC,Federation of Skye,Isle of Skye"], ["Phecda", -74.45, -1.6, "LC,Federation of Skye,Isle of Skye"], ["Wyatt", -67.26, -8.34, "LC,Federation of Skye,Isle of Skye"], ["Chara", -29.21, 6.41, "LC,Federation of Skye,Isle of Skye"], ["Lipton", -33.86, 6.41, "LC,Federation of Skye,Isle of Skye"], ["Oliver", -31.8, -7.03, "FWL"], ["Zavijava", -31.8, -0.3, "LC,Federation of Skye,Isle of Skye"], ["Zollikofen", -28.96, 19.34, "LC,Federation of Skye,Isle of Skye"], ["Alhena", -82.47, -14.52, "FWL"], ["Chertan", -74.71, -15.56, "FWL"], ["Dubhe", -70.58, -16.07, "FWL"], ["Wing", -75.22, -10.9, "FWL"], ["Callison", -62.56, -15.04, "FWL,Silver Hawk Coalition"], ["Marcus", -58.94, -15.56, "FWL,Silver Hawk Coalition"], ["Zosma", -50.16, -10.39, "FWL,Border Protectorate"], ["Denebola", -37.84, -1.62, "LC,Federation of Skye,Isle of Skye"], ["Dieron", 12.2, 14.91, "DC,Dieron Military District,Al Na'ir Prefecture,Major Capital"], ["Altair", 8.84, 13.75, "DC,Dieron Military District,Al Na'ir Prefecture"], ["Asta", 4.13, 25.54, "DC,Dieron Military District,Kessel Prefecture"], ["Fomalhaut", 20.93, 5.38, "FS,Draconis March,Robinson Operational Area,Addicks PDZ"], ["Caph", 12.92, -0.56, "FS,Draconis March,Robinson Operational Area,Addicks PDZ"], ["Bryant", 13.18, -13.23, "CC,Tikonov Commonality,Region 1"], ["Carver V (Liberty 3063+)", -5.44, -20.72, "CC,Tikonov Commonality,Region 1"], ["Epsilon Eridani", 18.35, -21.25, "CC,Tikonov Commonality,Region 2"], ["Epsilon Indi", 29.2, -15.56, "CC,Tikonov Commonality,Region 2"], ["Keid", 3.1, -10.13, "CC,Tikonov Commonality,Region 1"], ["New Home", 7.23, -12.72, "CC,Tikonov Commonality,Region 1"], ["Procyon", -5.04, -11.06, "FWL"], ["Sirius", -2.56, -7.86, "CC,Tikonov Commonality,Region 1"], ["Capolla", 8.0, -41.41, "CC,Tikonov Commonality,Region 4"], ["Outreach", -3.11, -34.69, "CC,Tikonov Commonality,Region 4"], ["Terra Firma", 22.5, -33.62, "CC,Tikonov Commonality,Region 5"], ["Alula Australis", -24.31, -4.7, "FWL,Border Protectorate"], ["Graham IV", -23.53, -10.39, "FWL,Sirian Concordat"], ["Thorin", -23.53, 7.96, "LC,Federation of Skye,Isle of Skye"], ["Muphrid", -27.4, 15.21, "LC,Federation of Skye,Isle of Skye"], ["New Earth", -12.42, 3.06, "LC,Federation of Skye,Isle of Skye"], ["Rigil Kentarus", -2.85, 2.54, "LC,Federation of Skye,Isle of Skye"], ["Yorii", -8.02, 21.15, "DC,Dieron Military District,Kessel Prefecture"], ["Terra", 0.0, 0.0, "CS"], ["Oporto (Veil 3075+)", -449.95, 307.61, "A"], ["Anatolia (Pillory 3130+)", -432.79, 276.44, "A"], ["Austerlitz (Scauld 3130+)", -432.67, 306.26, "A"], ["Edirne (Brank 3130+)", -462.4, 290.92, "A"], ["Lushun (Jibbet 3130+)", -412.16, 326.43, "A"], ["Lywick (Ferreusvirgo 3130+)", -439.43, 334.98, "A"], ["Seven Lands (Garotte 3130+)", -456.51, 261.64, "A"], ["Port Vail (The Rack 3050+)", -400.86, 370.98, "A"], ["Engadine", -351.28, 354.87, "LC,Protectorate of Donegal,Coventry Province"], ["Main Street", -377.93, 351.51, "LC,Protectorate of Donegal,Coventry Province"], ["Dijonne (Pain 3050+)", -408.67, 349.65, "A"], ["Botany Bay", -177.83, 483.08, "MV"], ["Gotterdammerung", -179.6, 465.61, "MV"], ["Last Chance", -159.79, 477.14, "MV"], ["Brockway", 218.17, -355.97, "FS,Capellan March,Taygeta Operational Area,Altair PDZ"], ["Electra", 215.32, -322.37, "FS,Capellan March,Taygeta Operational Area,Altair PDZ"], ["Lindsay", 206.53, -350.03, "FS,Capellan March,Taygeta Operational Area,Altair PDZ"], ["Maia", 214.54, -323.16, "FS,Capellan March,Taygeta Operational Area,Altair PDZ"], ["Merope", 213.25, -323.46, "FS,Capellan March,Taygeta Operational Area,Altair PDZ"], ["Midale", 189.47, -362.22, "FS,Capellan March,Taygeta Operational Area,Altair PDZ"], ["Pleiades Cluster (100)", 216.35, -319.6, "FS,Capellan March,Taygeta Operational Area,Altair PDZ"], ["Ridgebrook", 201.36, -319.6, "FS,Capellan March,Taygeta Operational Area,Altair PDZ"], ["Camadeierre", 217.73, -401.5, "TC,Hyades Union"], ["Hyades Cluster", 191.32, -389.55, "TC,Hyades Union"], ["Illiushin", 211.93, -397.51, "TC,Hyades Union"], ["Ishtar", 187.99, -388.08, "TC,Hyades Union"], ["Jamestown", 194.88, -387.72, "TC,Hyades Union"], ["Jansen's Hold", 183.99, -378.28, "TC,Hyades Union"], ["Landmark", 176.55, -396.71, "TC,Hyades Union"], ["MacLeod's Land", 169.48, -387.17, "TC,Hyades Union"], ["New Ganymede", 197.42, -377.37, "TC,Hyades Union"], ["New Vallis", 191.8, -375.56, "TC,Hyades Union"], ["New Vandenburg", 155.86, -405.63, "TC,Hyades Union"], ["Pinard", 173.96, -389.37, "TC,Hyades Union"], ["Renfield", 222.82, -385.18, "TC,Hyades Union"], ["Samantha", 191.43, -385.18, "TC,Hyades Union"], ["Taurus", 191.38, -391.0, "TC,Hyades Union,Faction Capital"], ["Fletcher's Feast", 677.5, -218.96, "TD"], ["Morgan's Holdfast", 672.61, -192.84, "TD"], ["New Gascony", 662.62, -261.24, "TD"], ["New Haiti (New Hati)", 652.29, -246.9, "TD"], ["New Port Royal", 658.46, -211.16, "TD"], ["Tortuga Prime", 664.72, -233.49, "TD,Faction Capital"], ["Santander V (Santander's World)", 77.8, 481.1, "I"], ["Porthos", 90.21, 475.92, "EF"], ["Mauna Loa", 1025.68, -119.06, "A"], ["Illizi", -1025.79, 147.9, "AP"], ["Kapoeta", -1010.42, 191.33, "AP"], ["Kebili", -961.93, 113.09, "AP"], ["Kefya", -1033.27, 178.51, "AP"], ["Ksabi", -1038.23, 114.62, "AP"], ["Mostaganem", -995.71, 99.92, "AP"], ["Nyamlell", -999.2, 149.58, "AP"], ["Saidia", -1007.36, 124.08, "AP"], ["Shahhat", -972.04, 139.55, "AP"], ["Tadjoura", -994.76, 174.81, "AP"], ["Tizga", -1036.57, 129.47, "AP"], ["Thala", -957.3, 167.13, "AP,Faction Capital"], ["Arcadia (Clan)", -115.56, 1607.54, "C"], ["Babylon", -123.41, 1599.63, "C"], ["Barcella", -23.73, 1894.96, "C"], ["Bearclaw", 149.36, 1722.12, "C"], ["Brim", -24.55, 1767.15, "C"], ["Dagda (Clan)", -132.17, 1602.6, "C"], ["Foster", 44.14, 1731.76, "C"], ["Gatekeeper", -22.62, 1777.96, "C"], ["Glory", 99.26, 1834.14, "C"], ["Grant's Station", -66.84, 1833.93, "C"], ["Hoard", 39.34, 1878.31, "C"], ["Huntress", 49.19, 1756.45, "C"], ["Kirin", -23.63, 1835.9, "C"], ["Londerholm", -42.25, 1871.26, "CSJ"], ["Marshall", 59.83, 1790.72, "C"], ["Roche", 67.84, 1868.52, "C"], ["Strato Domingo", 10.77, 1879.24, "C"], ["Tathis", 85.58, 1810.5, "C"], ["Tiber (Clan)", 89.49, 1875.31, "C"], ["Tokasha", 108.06, 1727.0, "C"], ["Zara (Homer 2850+)", -78.7, 1797.64, "C"], ["Strana Mechty", 32.27, 1766.39, "C,Faction Capital"], ["RWR Outpost #27", -752.59, 444.48, "CCon"], ["Tamaron", -2.03, 1855.58, "CCY,Faction Capital"], ["Bazaar", 23.56, 754.29, ""], ["Niles (Clan)", 118.97, 1705.41, "CHH,Faction Capital"], ["Hector", 151.35, 1768.33, "CIH,Faction Capital"], ["Trinity", -248.57, 760.81, ""], ["Gwithian", 261.12, 787.76, ""], ["Sheridan (Clan)", 125.91, 1792.81, "CSA,Faction Capital"], ["Suda Bay", 244.83, 946.95, ""], ["Transfer Facility 4", 293.09, 668.48, ""], ["Hellgate", 40.31, 1841.91, "CSV"], ["Kinbrace", -395.82, 862.97, ""], ["Harris", -141.21, 801.86, ""], ["Anklan", -861.92, 780.19, "HL"], ["Antwerp", -668.9, 869.79, "HL"], ["Bergen", -767.17, 741.27, "HL"], ["Braunschweig", -687.0, 849.97, "HL"], ["Bruges", -786.44, 885.8, "HL"], ["Danzig", -642.36, 847.36, "HL"], ["Dorpat", -731.35, 883.66, "HL"], ["Dortmund", -732.7, 781.85, "HL"], ["Elbing (HL)", -831.28, 818.6, "HL"], ["Falsterbo (HL)", -771.35, 843.43, "HL"], ["Gateway", -720.21, 642.49, "HL"], ["Goslar", -661.83, 747.2, "HL"], ["Greifswald", -666.85, 669.65, "HL"], ["Hamburg", -624.17, 806.6, "HL"], ["Kalmar (HL)", -824.07, 862.17, "HL"], ["Kampen", -739.13, 906.56, "HL"], ["Köln (HL)", -705.33, 721.1, "HL"], ["Köningsberg", -837.76, 896.74, "HL"], ["Lübeck", -702.69, 817.34, "HL"], ["Lynn", -761.31, 683.82, "HL"], ["Novgorod", -759.57, 940.2, "HL"], ["Riga", -862.84, 859.48, "HL"], ["Stettin (HL)", -806.39, 950.99, "HL"], ["Stralsund", -651.12, 735.32, "HL"], ["Thorn", -773.84, 665.94, "HL"], ["Tomalov", -664.13, 779.66, "HL"], ["Visby", -810.69, 739.71, "HL"], ["Wismar", -846.34, 944.49, "HL"], ["Bremen (HL)", -792.07, 806.46, "HL,Faction Capital"], ["Alexandrian Covenant", -126.48, -785.3, "I"], ["Farhome", 516.5, -613.23, "I"], ["Frobisher", -370.19, -469.95, "I"], ["Kleinwelt", -334.29, -423.68, "A"], ["Midden", -290.75, -590.14, "I"], ["New Sierra", 825.55, 76.7, "I"], ["Shady Palms", 801.66, -161.82, "I"], ["St. Andreas", -582.17, -365.52, "I"], ["Union of Samoyedic Colonies", -895.42, 34.78, "I"], ["Waystation 531", -741.98, 1348.15, "I"], ["Rest Stop", 801.11, 326.72, "IE"], ["Rover", 822.59, 207.38, "IE"], ["Skyfog", -59.98, -541.79, "IE"], ["Aragon", -667.35, 1127.05, "NC"], ["Castile", -657.33, 1107.48, "NC"], ["Córdoba", -689.24, 1151.6, "NC"], ["Galicia", -663.91, 1142.77, "NC"], ["León", -690.68, 1102.13, "NC"], ["Navarre", -713.38, 1146.09, "NC"], ["Valencia", -707.79, 1122.88, "NC"], ["Asturias", -718.97, 1102.76, "NC,Faction Capital"], ["Granada", -674.29, 1161.68, "NC,Faction Capital"], ["Anglia", 993.7, 200.9, "NDC"], ["Belgae", 954.81, 194.52, "NDC"], ["Dania", 943.21, 202.01, "NDC"], ["Halkidik", 981.56, 203.73, "NDC"], ["Helvetia", 975.93, 218.17, "NDC"], ["Hibernia", 966.92, 186.47, "NDC"], ["Karpathos", 964.2, 211.11, "NDC"], ["Lemnos", 989.7, 213.28, "NDC"], ["Thasos", 949.37, 210.03, "NDC"], ["New Delphi", 971.74, 201.77, "NDC,Faction Capital"], ["Monument to Man", 852.25, 538.33, "U"], ["Argondale", -942.41, -574.39, ""], ["Aurigae", 867.93, -1226.01, ""], ["Beehive Cluster", -404.97, -708.67, ""], ["Beta Salandor", 1255.49, -448.62, ""], ["Brundams", -1875.94, -441.64, ""], ["Caesar's Crown", -635.63, -196.1, ""], ["Chaffee (DP)", 275.62, -1756.63, ""], ["Death's Gaze Cluster", 486.81, -1707.65, ""], ["Doggerbank", -993.88, -280.69, ""], ["Dorian's Tears", -1128.13, 411.26, ""], ["Drachenfeld", 1181.66, -105.85, ""], ["Fager", 90.98, -1590.71, ""], ["Fröislandis", -1317.09, -641.78, ""], ["Gurgaldar", -1380.71, -296.35, ""], ["Heidrunn", -1875.72, 278.95, ""], ["Horgens", 215.95, -1189.37, ""], ["Interstellar Expeditions Base #14", -1498.77, 325.93, ""], ["Interstellar Expeditions Base #22", -733.71, -1751.74, ""], ["Interstellar Expeditions Base #6", 1284.28, -178.3, ""], ["Jordian Cluster", -1777.25, 585.0, ""], ["Kazlam", -1419.58, 803.49, ""], ["Knechee", -590.71, -1792.02, ""], ["Landrum", -1126.55, -573.67, ""], ["Leviathans Rest", -140.96, -1919.69, ""], ["Malador Cluster", -1045.1, -380.93, ""], ["Melidron", -602.09, -971.15, ""], ["Mizdargh", 399.24, -1337.71, ""], ["Nebula D77", 704.74, -1813.6, ""], ["Refuel Base Gamma", -1097.59, -238.09, ""], ["Richmond's World (Murrain 3025+)", 895.4, 28.76, ""], ["Star Cluster 1108 (RW)", 527.83, -1888.79, ""], ["Star Cluster 1108 (SW)", 1869.65, -672.34, ""], ["Star Cluster 643", 1935.84, -171.89, ""], ["Star Cluster 65", 803.17, -592.22, ""], ["Star Cluster 752", 61.45, -1373.43, ""], ["Star Cluster 814", -1021.89, -449.11, ""], ["Star Cluster 889", -104.72, -1723.63, ""], ["Star Cluster A51", 749.92, 1389.43, ""], ["Star Cluster Briceno 1", 1310.69, -569.84, ""], ["Star Cluster P12", 115.63, 1303.56, ""], ["Star Cluster P24", -398.78, 1519.34, ""], ["T Cephei (The Devil's Eye)", 617.2, -308.64, ""], ["Tansalir", -1549.59, -513.55, ""], ["The Eyes in the Dark", -935.26, 297.01, ""], ["The Swan's Eye", 640.36, -616.6, ""], ["Theta Carinae Cluster", 223.15, 471.76, ""]])
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/systems.js.map
;
/* Generated by Opal 0.6.2 */
(function($opal) {
  var $a, self = $opal.top, $scope = $opal, nil = $opal.nil, $breaker = $opal.breaker, $slice = $opal.slice, $klass = $opal.klass, $range = $opal.range, map = nil;

  $opal.add_stubs(['$attr_accessor', '$canvas_id', '$canvas', '$/', '$*', '$on', '$-', '$[]', '$rect', '$find', '$size', '$min', '$max', '$>', '$+', '$<', '$draw_planets', '$>=', '$width', '$height', '$context', '$each', '$draw_planet', '$x', '$zoom', '$y', '$include?', '$floor', '$==', '$new', '$draw_canvas']);
  ;
  ;
  ;
  (function($base, $super) {
    function $Map(){};
    var self = $Map = $klass($base, $super, 'Map', $Map);

    var def = self._proto, $scope = self._scope;

    def.width = def.height = def.zoom = nil;
    self.$attr_accessor("height", "width", "canvas", "context", "x", "y", "dragging", "zoom");

    def.$initialize = function() {
      var $a, $b, TMP_1, $c, TMP_2, $d, TMP_3, $e, TMP_4, $f, TMP_5, $g, self = this;

      self.height = $(window).height() * 0.9;
      self.width = $(window).width() * 0.9;
      self.canvas = document.getElementById(self.$canvas_id());
      self.context = self.$canvas().getContext('2d');
      self.x = self.width['$/'](2);
      self.y = (self.height['$/'](2))['$*'](-1.0);
      self.dragging = false;
      self.drag_start_x = 0;
      self.drag_start_y = 0;
      self.zoom = 1;
      ($a = ($b = (($c = $scope.Element) == null ? $opal.cm('Element') : $c).$find("#" + (self.$canvas_id()))).$on, $a._p = (TMP_1 = function(event){var self = TMP_1._s || this;
if (event == null) event = nil;
      self.drag_start_x = event['$[]']("clientX")['$-'](self.$rect().left);
        self.drag_start_y = event['$[]']("clientY")['$-'](self.$rect().top);
        return self.dragging = true;}, TMP_1._s = self, TMP_1), $a).call($b, "mousedown");
      ($a = ($c = (($d = $scope.Element) == null ? $opal.cm('Element') : $d).$find("#" + (self.$canvas_id()))).$on, $a._p = (TMP_2 = function(event){var self = TMP_2._s || this, $a, drag_end_x = nil, drag_end_y = nil, x_arr = nil, x_diff = nil, y_arr = nil, y_diff = nil;
        if (self.dragging == null) self.dragging = nil;
        if (self.drag_start_x == null) self.drag_start_x = nil;
        if (self.drag_start_y == null) self.drag_start_y = nil;
        if (self.x == null) self.x = nil;
        if (self.y == null) self.y = nil;
if (event == null) event = nil;
      if ((($a = self.dragging) !== nil && (!$a._isBoolean || $a == true))) {
          drag_end_x = event['$[]']("clientX")['$-'](self.$rect().left);
          drag_end_y = event['$[]']("clientY")['$-'](self.$rect().top);
          x_arr = [self.drag_start_x, drag_end_x];
          x_diff = ($range(x_arr.$min(), x_arr.$max(), false)).$size();
          y_arr = [self.drag_start_y, drag_end_y];
          y_diff = ($range(y_arr.$min(), y_arr.$max(), false)).$size();
          if (drag_end_x['$>'](self.drag_start_x)) {
            self.x = self.x['$+'](x_diff)
          } else if (drag_end_x['$<'](self.drag_start_x)) {
            self.x = self.x['$-'](x_diff)};
          if (drag_end_y['$<'](self.drag_start_y)) {
            self.y = self.y['$+'](y_diff)
          } else if (drag_end_x['$>'](self.drag_start_y)) {
            self.y = self.y['$-'](y_diff)};
          self.drag_start_x = drag_end_x;
          self.drag_start_y = drag_end_y;
          return self.$draw_planets();
          } else {
          return nil
        }}, TMP_2._s = self, TMP_2), $a).call($c, "mousemove");
      ($a = ($d = (($e = $scope.Element) == null ? $opal.cm('Element') : $e).$find("#" + (self.$canvas_id()))).$on, $a._p = (TMP_3 = function(event){var self = TMP_3._s || this;
if (event == null) event = nil;
      return self.dragging = false}, TMP_3._s = self, TMP_3), $a).call($d, "mouseup");
      ($a = ($e = (($f = $scope.Element) == null ? $opal.cm('Element') : $f).$find("#" + (self.$canvas_id()))).$on, $a._p = (TMP_4 = function(event){var self = TMP_4._s || this;
if (event == null) event = nil;
      return self.dragging = false}, TMP_4._s = self, TMP_4), $a).call($e, "mouseout");
      return ($a = ($f = (($g = $scope.Element) == null ? $opal.cm('Element') : $g).$find("#" + (self.$canvas_id()))).$on, $a._p = (TMP_5 = function(event){var self = TMP_5._s || this;
        if (self.mag == null) self.mag = nil;
        if (self.zoom == null) self.zoom = nil;
        if (self.x == null) self.x = nil;
        if (self.y == null) self.y = nil;
if (event == null) event = nil;
      self.mag = event['$[]']("deltaY");
        if (self.mag['$>'](0)) {
          self.zoom = self.zoom['$*'](2);
          self.x = self.x['$/'](2);
          self.y = self.y['$/'](2);
        } else if (self.zoom['$>='](1)) {
          self.zoom = self.zoom['$/'](2);
          self.x = self.x['$*'](2);
          self.y = self.y['$*'](2);};
        return self.$draw_planets();}, TMP_5._s = self, TMP_5), $a).call($f, "mousewheel");
    };

    def.$rect = function() {
      var self = this;

      return self.rect = self.$canvas().getBoundingClientRect();;
    };

    def.$draw_canvas = function() {
      var self = this;

      self.$canvas().width  = self.$width();
      self.$canvas().height = self.$height();
      self.$context().fillStyle = "#fff";
      self.$context().font = "10pt Arial";
      return self.$draw_planets();
    };

    def.$canvas_id = function() {
      var self = this;

      return "mapCanvas";
    };

    def.$draw_planets = function() {
      var $a, $b, TMP_6, $c, self = this;

      self.$context().clearRect(0,0, self.$canvas().width, self.$canvas().height);
      return ($a = ($b = (($c = $scope.SYSTEMS) == null ? $opal.cm('SYSTEMS') : $c)).$each, $a._p = (TMP_6 = function(p){var self = TMP_6._s || this;
if (p == null) p = nil;
      return self.$draw_planet(p['$[]'](0), p['$[]'](1), p['$[]'](2), p['$[]'](3))}, TMP_6._s = self, TMP_6), $a).call($b);
    };

    return (def.$draw_planet = function(name, system_x, system_y, faction) {
      var $a, $b, $c, $d, self = this;

      system_x = (system_x['$+'](self.$x()))['$*'](self.$zoom());
      system_y = ((system_y['$+'](self.$y()))['$*'](-1.0))['$*'](self.$zoom());
      if ((($a = ($b = ($c = (($d = system_x['$>'](0)) ? system_x['$<'](self.$width()) : $d), $c !== false && $c !== nil ?system_y['$>'](0) : $c), $b !== false && $b !== nil ?system_y['$<'](self.$height()) : $b)) !== nil && (!$a._isBoolean || $a == true))) {
        if ((($a = ((($b = ["Tharkad", "Terra", "New Avalon", "Luthien", "Atreus (FWL)", "Sian", "Strana Mechty"]['$include?'](name)) !== false && $b !== nil) ? $b : self.zoom['$>'](3))) !== nil && (!$a._isBoolean || $a == true))) {
          self.$context().fillStyle = "#fff";
          self.$context().fillText(name, system_x.$floor()['$+'](5)['$+'](self.zoom), system_y.$floor()['$+'](6)['$+'](self.zoom));};
        if (faction['$[]']($range(0, 1, false))['$==']("DC")) {
          self.$context().fillStyle = "#f00";
        } else if (faction['$[]']($range(0, 1, false))['$==']("FS")) {
          self.$context().fillStyle = "#ffff00";
        } else if (faction['$[]']($range(0, 1, false))['$==']("LC")) {
          self.$context().fillStyle = "#2e64fe";
        } else if (faction['$[]']($range(0, 1, false))['$==']("CC")) {
          self.$context().fillStyle = "#01df3a";
        } else if (faction['$[]']($range(0, 2, false))['$==']("FWL")) {
          self.$context().fillStyle = "#a901db";
          } else {
          self.$context().fillStyle = "#fff";
        };
        return self.$context().fillRect(system_x.$floor()['$+'](1), system_y.$floor()['$+'](1), self.$zoom(), self.$zoom());
        } else {
        return nil
      };
    }, nil) && 'draw_planet';
  })(self, null);
  map = (($a = $scope.Map) == null ? $opal.cm('Map') : $a).$new();
  return map.$draw_canvas();
})(Opal);

//# sourceMappingURL=/__opal_source_maps__/map.js.map
;
