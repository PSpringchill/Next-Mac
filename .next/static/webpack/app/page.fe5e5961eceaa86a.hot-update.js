"use strict";
/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
self["webpackHotUpdate_N_E"]("app/page",{

/***/ "(app-pages-browser)/./src/app/api/Page.tsx":
/*!******************************!*\
  !*** ./src/app/api/Page.tsx ***!
  \******************************/
/***/ (function(module, __webpack_exports__, __webpack_require__) {

eval(__webpack_require__.ts("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   OrderBookConsumer: function() { return /* binding */ OrderBookConsumer; },\n/* harmony export */   OrderBookContext: function() { return /* binding */ OrderBookContext; },\n/* harmony export */   OrderBookProvider: function() { return /* binding */ OrderBookProvider; },\n/* harmony export */   processOrderBookData: function() { return /* binding */ processOrderBookData; }\n/* harmony export */ });\n/* harmony import */ var react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react/jsx-dev-runtime */ \"(app-pages-browser)/./node_modules/next/dist/compiled/react/jsx-dev-runtime.js\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! react */ \"(app-pages-browser)/./node_modules/next/dist/compiled/react/index.js\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_1__);\n/* __next_internal_client_entry_do_not_use__ OrderBookProvider,OrderBookConsumer,processOrderBookData,OrderBookContext auto */ \nvar _s = $RefreshSig$();\n\nconst OrderBookContext = /*#__PURE__*/ (0,react__WEBPACK_IMPORTED_MODULE_1__.createContext)(null);\nconst BASE_URL = \"https://fapi.binance.com/fapi/v1/depth\";\nconst DEFAULT_SYMBOL = \"BTCUSDT\";\nconst DEFAULT_LIMIT = 50;\nfunction OrderBookProvider(param) {\n    let { symbol = DEFAULT_SYMBOL, limit = DEFAULT_LIMIT, children } = param;\n    _s();\n    const [orderBookData, setOrderBookData] = (0,react__WEBPACK_IMPORTED_MODULE_1__.useState)(null);\n    const [loading, setLoading] = (0,react__WEBPACK_IMPORTED_MODULE_1__.useState)(true);\n    const [error, setError] = (0,react__WEBPACK_IMPORTED_MODULE_1__.useState)(null);\n    (0,react__WEBPACK_IMPORTED_MODULE_1__.useEffect)(()=>{\n        let intervalId = null;\n        const fetchOrderBook = async ()=>{\n            try {\n                const queryParams = new URLSearchParams({\n                    symbol,\n                    limit: limit.toString()\n                });\n                const response = await fetch(\"\".concat(BASE_URL, \"?\").concat(queryParams.toString()));\n                if (!response.ok) {\n                    throw new Error(\"API request failed with status \".concat(response.status));\n                }\n                const data = await response.json();\n                setOrderBookData(data);\n                setLoading(false);\n            } catch (error) {\n                console.error(\"Error fetching order book data:\", error);\n                setError(error);\n                setLoading(false);\n            }\n        };\n        fetchOrderBook();\n        intervalId = setInterval(fetchOrderBook, 500);\n        // Cleanup function to cancel fetch if component unmounts before fetch completes\n        return ()=>{\n            if (intervalId) {\n                clearInterval(intervalId);\n            }\n        };\n    }, [\n        symbol,\n        limit\n    ]);\n    return /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(OrderBookContext.Provider, {\n        value: {\n            orderBookData,\n            loading,\n            error\n        },\n        children: children\n    }, void 0, false, {\n        fileName: \"/Users/donnapachpeantham/Code/Next-Mac/src/app/api/Page.tsx\",\n        lineNumber: 47,\n        columnNumber: 9\n    }, this);\n}\n_s(OrderBookProvider, \"ymjehGMue7Yu1GZYX7sq7SOHI2U=\");\n_c = OrderBookProvider;\nfunction OrderBookConsumer(param) {\n    let { children } = param;\n    return /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(OrderBookContext.Consumer, {\n        children: (value)=>// Render the children directly here\n            /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.Fragment, {\n                children: children\n            }, void 0, false)\n    }, void 0, false, {\n        fileName: \"/Users/donnapachpeantham/Code/Next-Mac/src/app/api/Page.tsx\",\n        lineNumber: 55,\n        columnNumber: 9\n    }, this);\n}\n_c1 = OrderBookConsumer;\nfunction processOrderBookData(orderBookData) {\n    const heatmapData = [];\n    orderBookData.bids.forEach((bid, index)=>{\n        heatmapData.push([\n            parseFloat(bid[0]),\n            index,\n            parseFloat(bid[1]) // Quantity \n        ]);\n    });\n    orderBookData.asks.forEach((ask, index)=>{\n        heatmapData.push([\n            parseFloat(ask[0]),\n            index + orderBookData.bids.length,\n            parseFloat(ask[1]) // Quantity \n        ]);\n    });\n    return heatmapData;\n}\n// Export OrderBookContext\n\nvar _c, _c1;\n$RefreshReg$(_c, \"OrderBookProvider\");\n$RefreshReg$(_c1, \"OrderBookConsumer\");\n\n\n;\n    // Wrapped in an IIFE to avoid polluting the global scope\n    ;\n    (function () {\n        var _a, _b;\n        // Legacy CSS implementations will `eval` browser code in a Node.js context\n        // to extract CSS. For backwards compatibility, we need to check we're in a\n        // browser context before continuing.\n        if (typeof self !== 'undefined' &&\n            // AMP / No-JS mode does not inject these helpers:\n            '$RefreshHelpers$' in self) {\n            // @ts-ignore __webpack_module__ is global\n            var currentExports = module.exports;\n            // @ts-ignore __webpack_module__ is global\n            var prevSignature = (_b = (_a = module.hot.data) === null || _a === void 0 ? void 0 : _a.prevSignature) !== null && _b !== void 0 ? _b : null;\n            // This cannot happen in MainTemplate because the exports mismatch between\n            // templating and execution.\n            self.$RefreshHelpers$.registerExportsForReactRefresh(currentExports, module.id);\n            // A module can be accepted automatically based on its exports, e.g. when\n            // it is a Refresh Boundary.\n            if (self.$RefreshHelpers$.isReactRefreshBoundary(currentExports)) {\n                // Save the previous exports signature on update so we can compare the boundary\n                // signatures. We avoid saving exports themselves since it causes memory leaks (https://github.com/vercel/next.js/pull/53797)\n                module.hot.dispose(function (data) {\n                    data.prevSignature =\n                        self.$RefreshHelpers$.getRefreshBoundarySignature(currentExports);\n                });\n                // Unconditionally accept an update to this module, we'll check if it's\n                // still a Refresh Boundary later.\n                // @ts-ignore importMeta is replaced in the loader\n                module.hot.accept();\n                // This field is set when the previous version of this module was a\n                // Refresh Boundary, letting us know we need to check for invalidation or\n                // enqueue an update.\n                if (prevSignature !== null) {\n                    // A boundary can become ineligible if its exports are incompatible\n                    // with the previous exports.\n                    //\n                    // For example, if you add/remove/change exports, we'll want to\n                    // re-execute the importing modules, and force those components to\n                    // re-render. Similarly, if you convert a class component to a\n                    // function, we want to invalidate the boundary.\n                    if (self.$RefreshHelpers$.shouldInvalidateReactRefreshBoundary(prevSignature, self.$RefreshHelpers$.getRefreshBoundarySignature(currentExports))) {\n                        module.hot.invalidate();\n                    }\n                    else {\n                        self.$RefreshHelpers$.scheduleUpdate();\n                    }\n                }\n            }\n            else {\n                // Since we just executed the code for the module, it's possible that the\n                // new exports made it ineligible for being a boundary.\n                // We only care about the case when we were _previously_ a boundary,\n                // because we already accepted this update (accidental side effect).\n                var isNoLongerABoundary = prevSignature !== null;\n                if (isNoLongerABoundary) {\n                    module.hot.invalidate();\n                }\n            }\n        }\n    })();\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKGFwcC1wYWdlcy1icm93c2VyKS8uL3NyYy9hcHAvYXBpL1BhZ2UudHN4IiwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7OztBQUU2RTtBQUM3RSxNQUFNSSxpQ0FBbUJELG9EQUFhQSxDQUFDO0FBQ3ZDLE1BQU1FLFdBQVc7QUFDakIsTUFBTUMsaUJBQWlCO0FBQ3ZCLE1BQU1DLGdCQUFnQjtBQUVmLFNBQVNDLGtCQUFrQixLQUFzSDtRQUF0SCxFQUFFQyxTQUFTSCxjQUFjLEVBQUVJLFFBQVFILGFBQWEsRUFBRUksUUFBUSxFQUE0RCxHQUF0SDs7SUFDOUIsTUFBTSxDQUFDQyxlQUFlQyxpQkFBaUIsR0FBR1osK0NBQVFBLENBQUM7SUFDbkQsTUFBTSxDQUFDYSxTQUFTQyxXQUFXLEdBQUdkLCtDQUFRQSxDQUFDO0lBQ3ZDLE1BQU0sQ0FBQ2UsT0FBT0MsU0FBUyxHQUFHaEIsK0NBQVFBLENBQUM7SUFFbkNDLGdEQUFTQSxDQUFDO1FBQ04sSUFBSWdCLGFBQWE7UUFDakIsTUFBTUMsaUJBQWlCO1lBQ25CLElBQUk7Z0JBQ0EsTUFBTUMsY0FBYyxJQUFJQyxnQkFBZ0I7b0JBQUVaO29CQUFRQyxPQUFPQSxNQUFNWSxRQUFRO2dCQUFHO2dCQUMxRSxNQUFNQyxXQUFXLE1BQU1DLE1BQU0sR0FBZUosT0FBWmYsVUFBUyxLQUEwQixPQUF2QmUsWUFBWUUsUUFBUTtnQkFFaEUsSUFBSSxDQUFDQyxTQUFTRSxFQUFFLEVBQUU7b0JBQ2QsTUFBTSxJQUFJQyxNQUFNLGtDQUFrRCxPQUFoQkgsU0FBU0ksTUFBTTtnQkFDckU7Z0JBRUEsTUFBTUMsT0FBTyxNQUFNTCxTQUFTTSxJQUFJO2dCQUNoQ2hCLGlCQUFpQmU7Z0JBQ2pCYixXQUFXO1lBQ2YsRUFBRSxPQUFPQyxPQUFPO2dCQUNaYyxRQUFRZCxLQUFLLENBQUMsbUNBQW1DQTtnQkFDakRDLFNBQVNEO2dCQUNURCxXQUFXO1lBQ2Y7UUFDSjtRQUVBSTtRQUVBRCxhQUFhYSxZQUFZWixnQkFBZ0I7UUFDekMsZ0ZBQWdGO1FBQ2hGLE9BQU87WUFDSCxJQUFJRCxZQUFZO2dCQUNaYyxjQUFjZDtZQUNsQjtRQUNKO0lBQ0osR0FBRztRQUFDVDtRQUFRQztLQUFNO0lBRWxCLHFCQUNJLDhEQUFDTixpQkFBaUI2QixRQUFRO1FBQUNDLE9BQU87WUFBRXRCO1lBQWVFO1lBQVNFO1FBQU07a0JBQzdETDs7Ozs7O0FBR2I7R0ExQ2dCSDtLQUFBQTtBQTRDVCxTQUFTMkIsa0JBQWtCLEtBQXFDO1FBQXJDLEVBQUV4QixRQUFRLEVBQTJCLEdBQXJDO0lBQzlCLHFCQUNJLDhEQUFDUCxpQkFBaUJnQyxRQUFRO2tCQUNyQixDQUFDRixRQUNFLG9DQUFvQzswQkFDcEM7MEJBQUd2Qjs7Ozs7OztBQUluQjtNQVRnQndCO0FBV1QsU0FBU0UscUJBQXFCekIsYUFBa0I7SUFDbkQsTUFBTTBCLGNBQWMsRUFBRTtJQUV0QjFCLGNBQWMyQixJQUFJLENBQUNDLE9BQU8sQ0FBQyxDQUFDQyxLQUFVQztRQUNsQ0osWUFBWUssSUFBSSxDQUFDO1lBQ2JDLFdBQVdILEdBQUcsQ0FBQyxFQUFFO1lBQ2pCQztZQUNBRSxXQUFXSCxHQUFHLENBQUMsRUFBRSxFQUFHLFlBQVk7U0FDbkM7SUFDTDtJQUVBN0IsY0FBY2lDLElBQUksQ0FBQ0wsT0FBTyxDQUFDLENBQUNNLEtBQVVKO1FBQ2xDSixZQUFZSyxJQUFJLENBQUM7WUFDYkMsV0FBV0UsR0FBRyxDQUFDLEVBQUU7WUFDakJKLFFBQVE5QixjQUFjMkIsSUFBSSxDQUFDUSxNQUFNO1lBQ2pDSCxXQUFXRSxHQUFHLENBQUMsRUFBRSxFQUFHLFlBQVk7U0FDbkM7SUFDTDtJQUNBLE9BQU9SO0FBQ1g7QUFFQSwwQkFBMEI7QUFDRSIsInNvdXJjZXMiOlsid2VicGFjazovL19OX0UvLi9zcmMvYXBwL2FwaS9QYWdlLnRzeD9jMjRiIl0sInNvdXJjZXNDb250ZW50IjpbIid1c2UgY2xpZW50JztcblxuaW1wb3J0IFJlYWN0LCB7IHVzZVN0YXRlLCB1c2VFZmZlY3QsIGNyZWF0ZUNvbnRleHQsIFJlYWN0Tm9kZSB9IGZyb20gJ3JlYWN0JztcbmNvbnN0IE9yZGVyQm9va0NvbnRleHQgPSBjcmVhdGVDb250ZXh0KG51bGwpO1xuY29uc3QgQkFTRV9VUkwgPSAnaHR0cHM6Ly9mYXBpLmJpbmFuY2UuY29tL2ZhcGkvdjEvZGVwdGgnO1xuY29uc3QgREVGQVVMVF9TWU1CT0wgPSAnQlRDVVNEVCc7XG5jb25zdCBERUZBVUxUX0xJTUlUID0gNTA7XG5cbmV4cG9ydCBmdW5jdGlvbiBPcmRlckJvb2tQcm92aWRlcih7IHN5bWJvbCA9IERFRkFVTFRfU1lNQk9MLCBsaW1pdCA9IERFRkFVTFRfTElNSVQsIGNoaWxkcmVuIH06IHsgc3ltYm9sPzogc3RyaW5nLCBsaW1pdD86IG51bWJlciwgY2hpbGRyZW46IFJlYWN0Tm9kZSB9KSB7XG4gICAgY29uc3QgW29yZGVyQm9va0RhdGEsIHNldE9yZGVyQm9va0RhdGFdID0gdXNlU3RhdGUobnVsbCk7XG4gICAgY29uc3QgW2xvYWRpbmcsIHNldExvYWRpbmddID0gdXNlU3RhdGUodHJ1ZSk7XG4gICAgY29uc3QgW2Vycm9yLCBzZXRFcnJvcl0gPSB1c2VTdGF0ZShudWxsKTtcblxuICAgIHVzZUVmZmVjdCgoKSA9PiB7XG4gICAgICAgIGxldCBpbnRlcnZhbElkID0gbnVsbDtcbiAgICAgICAgY29uc3QgZmV0Y2hPcmRlckJvb2sgPSBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHF1ZXJ5UGFyYW1zID0gbmV3IFVSTFNlYXJjaFBhcmFtcyh7IHN5bWJvbCwgbGltaXQ6IGxpbWl0LnRvU3RyaW5nKCkgfSk7XG4gICAgICAgICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChgJHtCQVNFX1VSTH0/JHtxdWVyeVBhcmFtcy50b1N0cmluZygpfWApO1xuXG4gICAgICAgICAgICAgICAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEFQSSByZXF1ZXN0IGZhaWxlZCB3aXRoIHN0YXR1cyAke3Jlc3BvbnNlLnN0YXR1c31gKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgcmVzcG9uc2UuanNvbigpOzsgXG4gICAgICAgICAgICAgICAgc2V0T3JkZXJCb29rRGF0YShkYXRhKTtcbiAgICAgICAgICAgICAgICBzZXRMb2FkaW5nKGZhbHNlKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgZmV0Y2hpbmcgb3JkZXIgYm9vayBkYXRhOicsIGVycm9yKTtcbiAgICAgICAgICAgICAgICBzZXRFcnJvcihlcnJvcik7XG4gICAgICAgICAgICAgICAgc2V0TG9hZGluZyhmYWxzZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG5cbiAgICAgICAgZmV0Y2hPcmRlckJvb2soKTtcblxuICAgICAgICBpbnRlcnZhbElkID0gc2V0SW50ZXJ2YWwoZmV0Y2hPcmRlckJvb2ssIDUwMCk7XG4gICAgICAgIC8vIENsZWFudXAgZnVuY3Rpb24gdG8gY2FuY2VsIGZldGNoIGlmIGNvbXBvbmVudCB1bm1vdW50cyBiZWZvcmUgZmV0Y2ggY29tcGxldGVzXG4gICAgICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgICAgICBpZiAoaW50ZXJ2YWxJZCkge1xuICAgICAgICAgICAgICAgIGNsZWFySW50ZXJ2YWwoaW50ZXJ2YWxJZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgfSwgW3N5bWJvbCwgbGltaXRdKTtcblxuICAgIHJldHVybiAoXG4gICAgICAgIDxPcmRlckJvb2tDb250ZXh0LlByb3ZpZGVyIHZhbHVlPXt7IG9yZGVyQm9va0RhdGEsIGxvYWRpbmcsIGVycm9yIH19PlxuICAgICAgICAgICAge2NoaWxkcmVufVxuICAgICAgICA8L09yZGVyQm9va0NvbnRleHQuUHJvdmlkZXI+XG4gICAgKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIE9yZGVyQm9va0NvbnN1bWVyKHsgY2hpbGRyZW4gfTogeyBjaGlsZHJlbjogUmVhY3ROb2RlIH0pIHtcbiAgICByZXR1cm4gKFxuICAgICAgICA8T3JkZXJCb29rQ29udGV4dC5Db25zdW1lcj5cbiAgICAgICAgICAgIHsodmFsdWUpID0+IChcbiAgICAgICAgICAgICAgICAvLyBSZW5kZXIgdGhlIGNoaWxkcmVuIGRpcmVjdGx5IGhlcmVcbiAgICAgICAgICAgICAgICA8PntjaGlsZHJlbn08Lz5cbiAgICAgICAgICAgICl9XG4gICAgICAgIDwvT3JkZXJCb29rQ29udGV4dC5Db25zdW1lcj5cbiAgICApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcHJvY2Vzc09yZGVyQm9va0RhdGEob3JkZXJCb29rRGF0YTogYW55KSB7XG4gICAgY29uc3QgaGVhdG1hcERhdGEgPSBbXTtcblxuICAgIG9yZGVyQm9va0RhdGEuYmlkcy5mb3JFYWNoKChiaWQ6IGFueSwgaW5kZXg6IG51bWJlcikgPT4ge1xuICAgICAgICBoZWF0bWFwRGF0YS5wdXNoKFtcbiAgICAgICAgICAgIHBhcnNlRmxvYXQoYmlkWzBdKSwgLy8gUHJpY2VcbiAgICAgICAgICAgIGluZGV4LCAgICAgICAgICAgICAgLy8gWS1pbmRleCBmb3IgYmlkXG4gICAgICAgICAgICBwYXJzZUZsb2F0KGJpZFsxXSkgIC8vIFF1YW50aXR5IFxuICAgICAgICBdKTtcbiAgICB9KTtcblxuICAgIG9yZGVyQm9va0RhdGEuYXNrcy5mb3JFYWNoKChhc2s6IGFueSwgaW5kZXg6IG51bWJlcikgPT4ge1xuICAgICAgICBoZWF0bWFwRGF0YS5wdXNoKFtcbiAgICAgICAgICAgIHBhcnNlRmxvYXQoYXNrWzBdKSwgLy8gUHJpY2VcbiAgICAgICAgICAgIGluZGV4ICsgb3JkZXJCb29rRGF0YS5iaWRzLmxlbmd0aCwgLy8gWS1pbmRleCBmb3IgYXNrXG4gICAgICAgICAgICBwYXJzZUZsb2F0KGFza1sxXSkgIC8vIFF1YW50aXR5IFxuICAgICAgICBdKTtcbiAgICB9KTtcbiAgICByZXR1cm4gaGVhdG1hcERhdGE7XG59XG5cbi8vIEV4cG9ydCBPcmRlckJvb2tDb250ZXh0XG5leHBvcnQgeyBPcmRlckJvb2tDb250ZXh0IH07XG4iXSwibmFtZXMiOlsiUmVhY3QiLCJ1c2VTdGF0ZSIsInVzZUVmZmVjdCIsImNyZWF0ZUNvbnRleHQiLCJPcmRlckJvb2tDb250ZXh0IiwiQkFTRV9VUkwiLCJERUZBVUxUX1NZTUJPTCIsIkRFRkFVTFRfTElNSVQiLCJPcmRlckJvb2tQcm92aWRlciIsInN5bWJvbCIsImxpbWl0IiwiY2hpbGRyZW4iLCJvcmRlckJvb2tEYXRhIiwic2V0T3JkZXJCb29rRGF0YSIsImxvYWRpbmciLCJzZXRMb2FkaW5nIiwiZXJyb3IiLCJzZXRFcnJvciIsImludGVydmFsSWQiLCJmZXRjaE9yZGVyQm9vayIsInF1ZXJ5UGFyYW1zIiwiVVJMU2VhcmNoUGFyYW1zIiwidG9TdHJpbmciLCJyZXNwb25zZSIsImZldGNoIiwib2siLCJFcnJvciIsInN0YXR1cyIsImRhdGEiLCJqc29uIiwiY29uc29sZSIsInNldEludGVydmFsIiwiY2xlYXJJbnRlcnZhbCIsIlByb3ZpZGVyIiwidmFsdWUiLCJPcmRlckJvb2tDb25zdW1lciIsIkNvbnN1bWVyIiwicHJvY2Vzc09yZGVyQm9va0RhdGEiLCJoZWF0bWFwRGF0YSIsImJpZHMiLCJmb3JFYWNoIiwiYmlkIiwiaW5kZXgiLCJwdXNoIiwicGFyc2VGbG9hdCIsImFza3MiLCJhc2siLCJsZW5ndGgiXSwic291cmNlUm9vdCI6IiJ9\n//# sourceURL=webpack-internal:///(app-pages-browser)/./src/app/api/Page.tsx\n"));

/***/ })

});