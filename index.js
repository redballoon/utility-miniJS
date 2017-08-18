// dependencies
var gulp = require('gulp'),
	debug = require('gulp-debug'),
	chalk = require('chalk'),
	filter = require('gulp-filter'),
	uglify = require('gulp-uglify'),
	concat = require('gulp-concat'),
	pump = require('pump'),
	header = require('gulp-header'),
	u = require('underscore');


var Mini = (function () {
	var defaults = {
		debug : false,
		header : ''
	},
	state = {
		init : false
	},
	ignore = {},
	bundles = {},
	queue = null,
	options = null;


	var methods = {
		log : function () {
			if (!options.debug) return;
			var namespace = 'Mini',
				color = chalk.green;
			Array.prototype.splice.call(arguments, 0, 0, color(namespace + ': '));
			console.log.apply(console, arguments);
		},
		reset : function () {
			ignore = {};
			bundles = {};
			queue = null;
			options.header = '';
		},
		/**
		*	CompressionFilterHandler -
		*	This is the default filter that is used to ignore files that should not be
		*	compressed. In this case, we ignore any file that ends in 'min.js'.
		*	@param {object} file - argument will be a vinyl object.
		*/
		compressionFilterHandler : function (file) {
			return file.relative.indexOf('min.js') === -1;
		},
		/**
		*	Ignore -
		*	Add files that will be ignored when compressing and concacting files together.
		*	You can add files to be ignored only in a bundle or globally by all bundles.
		*	@param {object} o - options for adding file(s) to be ignored
		*		@param {string} name - The name of the bundle that will ignore these files,
		*		you can use 'global' to ignore the files on ALL bundles.
		*
		*		@include {array} include - An array of objects that specify the base and
		*		a list of files within that base that will be ignored.
		*/
		ignore : function (o) {
			// validate arguments
			if (!o || typeof o.name !== 'string') {
				methods.log('ignore: invalid argument for name.');
				return false;
			}
			if (typeof o.include === 'undefined') {
				methods.log('ignore: invalid argument for include.');
				return false;	
			}
			if (typeof ignore[o.name] === 'undefined') {
				ignore[o.name] = { files : [] };
			}

			// log
			methods.log('ignore: added files to:', o.name);

			// iterate through all our ignore entries
			u.each(o.include, function (child) {
				var flag = true;
				
				// validate arguments
				if (!child.base || typeof child.base !== 'string') {
					methods.log('ignore: invalid argument for base.');
					flag = false;
				}
				if (!child.files || !u.isArray(child.files) || !child.files.length) {
					methods.log('ignore: invalid argument for files.');
					flag = false;
				}
				if (flag) {
					var base = child.base;
						base = base.charAt(base.length - 1) !== '/' ? base + '/' : base;

					var entry = child.files.length === 1 ? base + child.files : base + '{' + child.files.join(',') + '}';
						entry = '!' + entry;
					
					ignore[o.name].files.push(entry);
				}
			});
		},
		/**
		*	Add -
		*	create a bundle.
		*	@param {string} name  - a label for the bundle
		*	@param {object} o - options
		*		@param {(string | array)} source - a list of sources
		*		@param {object} destination -
		*			@param {string} base - a base path for the destination
		*			@param {string} name - the filename
		*		@param {function} filter -
		*/
		add : function (name, o) {
			// log
			methods.log('add:', name);

			// validate arguments
			if (!name || typeof name !== 'string') {
				methods.log('add: invalid value for name.');
				return false;
			}
			if (!o || typeof o.source === 'undefined') {
				methods.log('add: invalid value for source.');
				return false;	
			}
			if (typeof o.destination === 'undefined') {
				methods.log('add: invalid value for destination.');
				return false;
			}
			if (typeof bundles[name] !== 'undefined') {
				methods.log('add: bundle names must be unique.');
				return false;
			}

			if (typeof o.filter === 'function') {
				o.filterHandler = o.filter;
				o.filter = filter(o.filterHandler, {});
			} else {
				o.filter = null;	
			}
			o.compressionFilter = filter(methods.compressionFilterHandler, { restore : true });
			
			bundles[name] = o;
		},
		/**
		*	Compress -
		*/
		compress : function (name, bundle) {
			// log
			methods.log('compress:', name);
			
			// sources is always an array of items
			var sources = typeof bundle.source === 'string' ? [bundle.source] : bundle.source,
				streams = [];
			
			// add globally ignored files
			if (typeof ignore.global !== 'undefined') {
				sources = sources.concat(ignore.global.files);
			}
			// add locally ignored files
			if (typeof ignore[name] !== 'undefined') {
				sources = sources.concat(ignore[name].files);
			}

			// log
			methods.log('compress: log src:', sources);

			// building streams array
				// add sources
			streams.push(gulp.src(sources));
				// add filter to only add certain files to a bundle
			if (bundle.filter) streams.push(bundle.filter);
				// add compression filter to avoid files that are already minified
			streams.push(bundle.compressionFilter);
				// add compression
			streams.push(uglify());
				// reset filter
			streams.push(bundle.compressionFilter.restore);
				// log file to console
			streams.push(debug({ title : 'included:', color : chalk.yellow }));
				// concat files
			streams.push(concat(bundle.destination.name, { newLine : '\n;' }));
				// add header comment
			if (options.header) streams.push(header(options.header));
			streams.push(gulp.dest(bundle.destination.base));

			// run stream
			pump(streams, function (error) {
				methods.log('compress: complete:');
				// error
				if (typeof errror !== 'undefined') {
					methods.log('compress: complete: an error occured.', error);
					if (typeof options.complete === 'function') options.complete(false);
					return;
				}
				// run the next bundle
				methods.next();
			});
		},
		/**
		*	Next -
		*	Grabs the next bundle in the queue and runs it. If the queue is empty then it calls the
		*	complete callback.
		*/
		next : function () {
			//methods.log('next:');
			
			// queue is empty
			if (!queue || !queue.length) {
				methods.log('next: queue is empty.');
				methods.reset();
				if (typeof options.complete === 'function') options.complete(true);
				return;
			}
			// get the next bundle
			var name = queue.shift();
			if (typeof bundles[name] === 'undefined') {
				methods.log('next: bundle not found.');
				if (typeof options.complete === 'function') options.complete(false);
				return;
			}
			// run next bundle
			methods.compress(name, bundles[name]);
		},
		/**
		*	It -
		*	Starts the process by making a queue for all bundles, if any one fails then the queue stops.
		*/
		it : function (callback) {
			// set a callback
			options.complete = typeof callback === 'function' ? callback : null;
			// reset queue
			queue = [];
			// queue all bundles
			u.each(bundles, function (bundle, name) {
				queue.push(name);
			});
			// start
			methods.next();
		},
		init : function (o) {
			// initialize only once
			if (state.init) {
				return Mini;
			}
			// run any initialization logic
			options = u.extend(defaults, o);

			state.init = true;
			return Mini;
		}
	};
	return methods;
})();

module.exports = function (o) {
	return Mini.init(o);
};