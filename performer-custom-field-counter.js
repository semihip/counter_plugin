(function () {
    "use strict";

    const React = window.PluginApi.React;

    const FIELD_NAME = "custom_field";

    // Number of scenes retrieved per GraphQL request.
    const PAGE_SIZE = 500;

    // How long the calculated values remain valid.
    // 5 minutes = 300000 ms.
    const CACHE_DURATION = 5 * 60 * 1000;

    /*
     * Map:
     *
     * performerId -> sum(custom_field)
     *
     * Example:
     * {
     *     "1": 27,
     *     "2": 103,
     *     "3": 8
     * }
     */
    let totalsByPerformer = new Map();

    let loadedAt = 0;

    /*
     * Prevent multiple performer cards rendered at the same time
     * from starting multiple complete data loads.
     */
    let loadingPromise = null;


    // ------------------------------------------------------------
    // GraphQL helper
    // ------------------------------------------------------------

    async function graphql(query, variables = {}) {
        const response = await fetch("/graphql", {
            method: "POST",
            credentials: "same-origin",

            headers: {
                "Content-Type": "application/json",
            },

            body: JSON.stringify({
                query,
                variables,
            }),
        });

        if (!response.ok) {
            throw new Error(
                `GraphQL request failed: ${response.status}`
            );
        }

        const result = await response.json();

        if (result.errors) {
            console.error(
                "[Performer Custom Field Counter] GraphQL errors:",
                result.errors
            );

            throw new Error(result.errors[0].message);
        }

        return result.data;
    }


    // ------------------------------------------------------------
    // Load and aggregate all scenes
    // ------------------------------------------------------------

    async function loadTotals() {

        /*
         * If our cache is still valid, nothing needs to be done.
         */
        if (
            totalsByPerformer.size > 0 &&
            Date.now() - loadedAt < CACHE_DURATION
        ) {
            return totalsByPerformer;
        }


        /*
         * If another card is already loading the data,
         * wait for that same request instead of starting another one.
         */
        if (loadingPromise) {
            return loadingPromise;
        }


        loadingPromise = (async () => {

            const totals = new Map();

            let page = 1;
            let totalPages = 1;

            do {

                console.log(
                    `[Performer Custom Field Counter] Loading scenes page ${page}/${totalPages}`
                );


                const query = `
                    query PerformerCustomFieldCounter(
                        $filter: FindFilterType
                    ) {
                        findScenes(
                            filter: $filter
                        ) {
                            count
                            pages
                            scenes {
                                id
                                performers {
                                    performer {
                                        id
                                    }
                                }
                                custom_fields
                            }
                        }
                    }
                `;


                const data = await graphql(query, {
                    filter: {
                        page: page,
                        per_page: PAGE_SIZE,
                    },
                });


                const result = data?.findScenes;

                if (!result) {
                    break;
                }


                totalPages = result.pages || 1;


                for (const scene of result.scenes || []) {

                    const value = scene.custom_fields?.[FIELD_NAME];

                    /*
                     * custom_field is an integer.
                     *
                     * We explicitly ignore null / undefined / empty
                     * values.
                     */
                    if (
                        value === null ||
                        value === undefined ||
                        value === ""
                    ) {
                        continue;
                    }


                    const integerValue = Number(value);

                    if (!Number.isInteger(integerValue)) {
                        continue;
                    }


                    /*
                     * A scene can have multiple performers.
                     *
                     * Add the scene's value to every performer
                     * attached to that scene.
                     */
                    for (const performerEntry of scene.performers || []) {

                        const performer = performerEntry?.performer;

                        if (!performer?.id) {
                            continue;
                        }


                        const performerId = String(performer.id);

                        const current =
                            totals.get(performerId) || 0;


                        totals.set(
                            performerId,
                            current + integerValue
                        );
                    }
                }


                page++;

            } while (page <= totalPages);


            /*
             * Atomically replace the previous cache.
             */
            totalsByPerformer = totals;

            loadedAt = Date.now();

            console.log(
                `[Performer Custom Field Counter] Loaded totals for ${totals.size} performers`
            );


            return totals;

        })();


        try {
            return await loadingPromise;
        } finally {
            loadingPromise = null;
        }
    }


    // ------------------------------------------------------------
    // Counter React component
    // ------------------------------------------------------------

    function CounterOverlay({ performerId }) {

        const [value, setValue] = React.useState(null);


        React.useEffect(() => {

            let cancelled = false;


            loadTotals()
                .then((totals) => {

                    if (cancelled) {
                        return;
                    }


                    const total =
                        totals.get(String(performerId)) || 0;


                    setValue(total);
                })

                .catch((error) => {

                    console.error(
                        "[Performer Custom Field Counter]",
                        error
                    );

                    if (!cancelled) {
                        setValue(0);
                    }
                });


            return () => {
                cancelled = true;
            };

        }, [performerId]);


        /*
         * Do not display anything while the initial aggregation
         * is running.
         */
        if (value === null) {
            return null;
        }


        /*
         * Hide performers whose total is zero.
         */
        if (value === 0) {
            return null;
        }


        return React.createElement(
            "div",
            {
                className:
                    "performer-custom-field-counter",

                title:
                    `${FIELD_NAME}: ${value}`,
            },
            value
        );
    }


    // ------------------------------------------------------------
    // Performer card integration
    // ------------------------------------------------------------

    window.PluginApi.patch.after(
        "PerformerCard.Overlays",

        function (args, rendered) {

            const props = args?.[0];

            const performer = props?.performer;


            if (!performer?.id) {
                return rendered;
            }


            return React.createElement(
                React.Fragment,
                null,

                rendered,

                React.createElement(
                    CounterOverlay,
                    {
                        performerId: performer.id,

                        key:
                            `custom-field-counter-${performer.id}`,
                    }
                )
            );
        }
    );


    // ------------------------------------------------------------
    // Optional manual refresh
    // ------------------------------------------------------------

    /*
     * Expose a function that can be called from the browser
     * console while developing/testing.
     *
     * Example:
     *
     *   PerformerCustomFieldCounter.refresh()
     */
    window.PerformerCustomFieldCounter = {

        async refresh() {

            totalsByPerformer = new Map();

            loadedAt = 0;

            await loadTotals();

            console.log(
                "[Performer Custom Field Counter] Cache refreshed"
            );
        },

        getTotal(performerId) {

            return (
                totalsByPerformer.get(String(performerId)) || 0
            );
        },
    };


    console.log(
        "[Performer Custom Field Counter] Plugin loaded"
    );

})();
