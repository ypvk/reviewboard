/*
 * The base model for all API-backed resource models.
 *
 * This provides a common set of attributes and functionality for working
 * with Review Board's REST API. That includes fetching data for a known
 * resource, creating resources, saving, deleting, and navigating children
 * resources by way of a payload's list of links.
 *
 * Other resource models are expected to extend this. In particular, they
 * should generally be extending toJSON() and parse().
 */
RB.BaseResource = Backbone.Model.extend({
    defaults: {
        links: null,
        loaded: false,
        parentObject: null
    },

    /* The key for the namespace for the object's payload in a response. */
    rspNamespace: '',

    listKey: function() {
        return this.rspNamespace + 's';
    },

    /*
     * Returns the URL for this resource's instance.
     *
     * If this resource is loaded and has a URL to itself, that URL will
     * be returned.
     *
     * If not yet loaded, it'll try to get it from its parent object, if
     * any.
     *
     * This will return null if we can't auto-determine the URL.
     */
    url: function() {
        var links = this.get('links'),
            baseURL,
            key,
            link,
            parentObject;

        if (links) {
            return links.self.href;
        } else {
            parentObject = this.get('parentObject');

            if (parentObject) {
                /*
                 * XXX This is temporary to support older-style resource
                 *     objects. We should just use get() once we're moved
                 *     entirely onto BaseResource.
                 */
                if (parentObject.cid) {
                    links = parentObject.get('links');
                } else {
                    links = parentObject.links;
                }

                if (links) {
                    key = _.result(this, 'listKey');
                    link = links[key];

                    if (link) {
                        baseURL = link.href;

                        return this.isNew() ? baseURL : baseURL + this.id;
                    }
                }
            }
        }

        return null;
    },

    /*
     * Calls a function when the object is ready to use.
     *
     * An object is ready it has an ID and is loaded, or is a new resource.
     *
     * When the object is ready, options.ready() will be called. This may
     * be called immediately, or after one or more round trips to the server.
     *
     * If we fail to load the resource, objects.error() will be called instead.
     */
    ready: function(options, context) {
        options = options || {};

        if (!this.get('loaded') && !this.isNew()) {
            this.fetch({
                success: options.ready
                         ? _.bind(options.ready, context)
                         : undefined,
                error: options.error
                       ? _.bind(options.error, context)
                       : undefined
            });
        } else if (options.ready) {
            options.ready.call(context);
        }
    },

    /*
     * Calls a function when we know an object exists server-side.
     *
     * This works like ready() in that it's used to delay operating on the
     * resource until we have a server-side representation. Unlike ready(),
     * it will attempt to create it if it doesn't exist first.
     *
     * When the object has been created, or we know it already is,
     * options.success() will be called.
     *
     * If we fail to create the object, options.error() will be called
     * instead.
     */
    ensureCreated: function(options, context) {
        options = options || {};

        this.ready({
            ready: function() {
                if (!this.get('loaded')) {
                    this.save({
                        success: _.isFunction(options.success)
                                 ? _.bind(options.success, context)
                                 : undefined,
                        error: _.isFunction(options.error)
                               ? _.bind(options.error, context)
                               : undefined
                    });
                } else if (_.isFunction(options.success)) {
                    options.success.call(context);
                }
            }
        }, this);
    },

    /*
     * Fetches the object's data from the server.
     *
     * An object must have an ID before it can be fetched. Otherwise,
     * options.error() will be called.
     *
     * If this has a parent resource object, we'll ensure that's ready before
     * fetching this resource.
     *
     * The resource must override the parse() function to determine how
     * the returned resource data is parsed and what data is stored in
     * this object.
     *
     * If we successfully fetch the resource, options.success() will be
     * called.
     *
     * If we fail to fetch the resource, options.error() will be called.
     */
    fetch: function(options) {
        var parentObject,
            fetchObject = _.bind(function() {
                Backbone.Model.prototype.fetch.call(this, options);
            }, this);

        options = options || {};

        if (this.isNew()) {
            if (_.isFunction(options.error)) {
                options.error(
                    'fetch cannot be used on a resource without an ID');
            }

            return;
        }

        parentObject = this.get('parentObject');

        if (parentObject) {
            if (parentObject.cid) {
                parentObject.ready({
                    ready: fetchObject,
                    error: options.error
                }, this);
            } else {
                parentObject.ready(fetchObject);
            }
        } else {
            fetchObject();
        }
    },

    /*
     * Saves the object's data to the server.
     *
     * If the object has an ID already, it will be saved to its known
     * URL using HTTP PUT. If it doesn't have an ID, it will be saved
     * to its parent list resource using HTTP POST
     *
     * If this has a parent resource object, we'll ensure that's created
     * before saving this resource.
     *
     * An object must either be loaded or have a parent resource linking to
     * this object's list resource URL for an object to be saved.
     *
     * The resource must override the toJSON() function to determine what
     * data is saved to the server.
     *
     * If we successfully save the resource, options.success() will be
     * called.
     *
     * If we fail to save the resource, options.error() will be called.
     */
    save: function(options) {
        var url = _.result(this, 'url'),
            saveObject = _.bind(function() {
                Backbone.Model.prototype.save.call(this, {}, options);
            }, this);

        options = options || {};

        if (!url) {
            if (_.isFunction(options.error)) {
                options.error('The object must either be loaded from the ' +
                              'server or have a parent object before it can ' +
                              'be saved');
            }

            return;
        }

        this.ready({
            ready: function() {
                var parentObject = this.get('parentObject');

                if (parentObject) {
                    if (parentObject.cid) {
                        parentObject.ensureCreated({
                            success: saveObject,
                            error: options.error
                        }, this);
                    } else {
                        parentObject.ensureCreated(saveObject);
                    }
                } else {
                    saveObject();
                }
            },
            error: options.error
        }, this);
    },

    /*
     * Deletes the object's resource on the server.
     *
     * An object must either be loaded or have a parent resource linking to
     * this object's list resource URL for an object to be deleted.
     *
     * If we successfully delete the resource, options.success() will be
     * called.
     *
     * If we fail to delete the resource, options.error() will be called.
     */
    destroy: function(options) {
        var url = _.result(this, 'url');

        options = options || {};

        if (!url) {
            if (_.isFunction(options.error)) {
                options.error('The object must either be loaded from the ' +
                              'server or have a parent object before it can ' +
                              'be deleted');
            }

            return;
        }

        options = options || {};

        this.ready({
            ready: function() {
                Backbone.Model.prototype.destroy.call(this, options);
            },
            error: options.error
        }, this);
    },

    /*
     * Parses and returns the payload from an API response.
     *
     * This will by default only return the object's ID and list of links.
     * Subclasses should override this to return any additional data that's
     * needed, but they must include the results of
     * BaseResource.protoype.parse as well.
     */
    parse: function(rsp) {
        var rspData = rsp[this.rspNamespace];

        return {
            id: rspData.id,
            links: rspData.links,
            loaded: true
        };
    },

    /*
     * Serializes and returns object data for the purpose of saving.
     *
     * When saving to the server, the only data that will be sent in the
     * API PUT/POST call will be the data returned from toJSON(). Subclasses
     * must override this to specify what data they need to provide the API.
     */
    toJSON: function() {
        return {};
    }
});
