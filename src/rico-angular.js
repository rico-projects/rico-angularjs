/* 
 * Copyright 2018 Karakun AG.
 * Copyright 2015-2018 Canoo Engineering AG.
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';
var ricoClient = require('../bower_components/rico-js/dist/rico.js');
window.client = ricoClient;
angular.module('Rico', []);


angular.module('Rico').provider('$ricoConfig', [function () {

    var $cfg = {};
    this.configure = function (cfg) {
        $cfg = cfg;
    };

    this.$get = function () {
        return $cfg;
    };

}]);

angular.module('Rico').factory('logger', function () {
    return ricoClient.LoggerFactory.getLogger('Rico');
});

angular.module('Rico').factory('clientContextFactory', function () {
    return ricoClient.getService('ClientContextFactory');
});

angular.module('Rico').factory('vanillaClientContext', ['clientContextFactory', '$ricoConfig', function (clientContextFactory, $ricoConfig) {
    return clientContextFactory.create($ricoConfig.REMOTING_URL, $ricoConfig);
}]);

angular.module('Rico').factory('handlerCache', ['$cacheFactory', function ($cacheFactory) {
    return $cacheFactory('handlers');
}]);

angular.module('Rico').factory('modelBinding', ['$rootScope', '$timeout', 'vanillaClientContext', 'handlerCache', 'logger', function ($rootScope, $timeout, vanillaClientContext, handlerCache, logger) {

    $rootScope.waitingForGlobalApply = false;

    $rootScope.applyInAngular = function () {
        if (!$rootScope.waitingForGlobalApply) {
            $rootScope.waitingForGlobalApply = true;
            $timeout(function () {
                $rootScope.waitingForGlobalApply = false;
                logger.debug('Creating Rico controller');
                $rootScope.$apply();
            }, 100);
        }
    };

    var modelBinding = {

        injectArray: function (baseArray, startIndex, insertArray) {
            baseArray.splice.apply(baseArray, [startIndex, 0].concat(insertArray));
        },
        exists: function (object) {
            return typeof object !== 'undefined' && object !== null;
        },
        deepEqual: function (array1, array2) {
            if (array1 === array2 || (!this.exists(array1) && !this.exists(array2))) {
                return true;
            }
            if (this.exists(array1) !== this.exists(array2)) {
                return false;
            }
            var n = array1.length;
            if (array2.length !== n) {
                return false;
            }
            for (var i = 0; i < n; i++) {
                if (array1[i] !== array2[i]) {
                    return false;
                }
            }
            return true;
        },
        init: function (beanManager) {
            var handlers = [];
            var onBeanAddedHandlerResult = beanManager.onAdded(modelBinding.onBeanAddedHandler);
            handlers.push(onBeanAddedHandlerResult);
            var onBeanRemovedHandlerResult = beanManager.onRemoved(modelBinding.onBeanRemovedHandler);
            handlers.push(onBeanRemovedHandlerResult);
            var onBeanUpdateHandlerResult = beanManager.onBeanUpdate(modelBinding.onBeanUpdateHandler);
            handlers.push(onBeanUpdateHandlerResult);
            var onArrayUpdateHandlerResult = beanManager.onArrayUpdate(modelBinding.onArrayUpdateHandler);
            handlers.push(onArrayUpdateHandlerResult);

            handlerCache.put('handlers', handlers);
            logger.debug('Rico remoting model binding listeners for Angular registered');
        },
        watchAttribute: function (bean, attribute) {
            logger.debug('Added Angular listener for property ' + attribute + ' of bean ' + JSON.stringify(bean));
            $rootScope.$watch(
                function () {
                    return bean[attribute];
                },
                function (newValue, oldValue) {
                    logger.debug('Value ' + attribute + ' of bean ' + JSON.stringify(bean) + ' changed from ' + oldValue + ' to ' + newValue);
                    vanillaClientContext.beanManager.classRepository.notifyBeanChange(bean, attribute, newValue);
                }
            );
        },
        onBeanAddedHandler: function (bean) {
            logger.debug('Bean ' + JSON.stringify(bean) + ' added');

            for (var attr in bean) {
                modelBinding.watchAttribute(bean, attr);
            }

            $rootScope.applyInAngular();
        },
        onBeanRemovedHandler: function (bean) {
            logger.debug('Bean ' + JSON.stringify(bean) + ' removed');
            $rootScope.applyInAngular();
        },
        onBeanUpdateHandler: function (bean, propertyName, newValue, oldValue) {
            var newProperty = true;
            for (var attr in bean) {
                if (attr === propertyName) {
                    newProperty = false;
                }
            }

            if (newProperty) {
                logger.debug('Value ' + propertyName + ' was added to bean ' + JSON.stringify(bean));
                modelBinding.watchAttribute(bean, propertyName);
            }

            if (oldValue === newValue) {
                logger.debug('Received bean update for property ' + propertyName + ' without any change');
                return;
            }

            logger.debug('Bean update for property ' + propertyName + ' with new value "' + newValue + '"');

            bean[propertyName] = newValue;
            $rootScope.applyInAngular();
        },
        onArrayUpdateHandler: function (bean, propertyName, index, count, newElements) {
            var array = bean[propertyName];
            var oldElements = array.slice(index, index + count);
            if (modelBinding.deepEqual(newElements, oldElements)) {
                return;
            }

            logger.debug('Array update for property ' + propertyName + ' starting at index ' + index + ' with ' + JSON.stringify(newElements));

            if (typeof newElements === 'undefined' || (newElements && newElements.length === 0)) {
                array.splice(index, count);
                $rootScope.applyInAngular();
            } else {
                modelBinding.injectArray(array, index, newElements);

                for (bean in newElements) {
                    for (var attr in bean) {
                        modelBinding.watchAttribute(bean, attr);
                    }
                }

                $rootScope.applyInAngular();
            }
        }
    };

    logger.debug('Rico remoting model binding created');

    return modelBinding;

}]);

angular.module('Rico').factory('clientContext', ['vanillaClientContext', 'modelBinding', '$window', 'handlerCache', 'logger', function (vanillaClientContext, modelBinding, $window, handlerCache, logger) {
    var clientContext = {
        createController: function (scope, controllerName) {
            return vanillaClientContext.createController(controllerName).then(function (controllerProxy) {
                logger.debug('Creating Rico remoting controller proxy ' + controllerName);
                scope.$on('$destroy', function () {
                    logger.debug('Destroying Rico remoting controller proxy ' + controllerName);
                    controllerProxy.destroy();
                });
                scope.model = controllerProxy.model;
                return controllerProxy;
            });
        },
        disconnect: function () {
            vanillaClientContext.disconnect().then(function () {
                logger.debug('Rico remoting context disconnected');
                //unsubscribe the handlers
                const handlerArray = handlerCache.get('handlers');
                for (var i = 0; i < handlerArray.length; i++) {
                    const handler = handlerArray[i];
                    handler.unsubscribe();
                }
                handlerCache.remove('handlers');
            });
        },
        connect: function () {
            vanillaClientContext.connect().then(function () {
                logger.debug('Rico remoting context connected');
            });
        },
        onConnect: function () {
            return vanillaClientContext.onConnect().then(function () {
                logger.debug('Rico remoting context connected');
            });
        }
    };

    modelBinding.init(vanillaClientContext.beanManager);
    $window.onbeforeunload = clientContext.disconnect;

    logger.debug('Rico remoting context created');

    return clientContext;
}]);
