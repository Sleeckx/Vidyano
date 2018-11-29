namespace Vidyano.WebComponents {
    "use strict";

    @WebComponent.register({
        properties: {
            color: {
                type: String,
                reflectToAttribute: true
            }
        },
        observers: [
            "_updateColor(color, isConnected)"
        ]
    })
    export class Spinner extends WebComponent {
        private static _spinnerConfig: SpinnerConfig;

        static get template() {
            if (typeof Spinner._spinnerConfig === "undefined")
                Spinner._spinnerConfig = window.app.configuration.getSpinnerConfig();

            if (Spinner._spinnerConfig)
                return Spinner._spinnerConfig.template.cloneNode(true);

            return Polymer.DomModule.import('vi-spinner', 'template');
        }

        private _updateColor(color: string, isConnected: boolean) {
            this.updateStyles({
                "--vi-spinner-color": color
            });
        }
    }
}