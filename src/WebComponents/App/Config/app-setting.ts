namespace Vidyano.WebComponents {
    "use strict";

    @WebComponent.register({
        properties: {
            key: String,
            value: String
        },
        hostAttributes: {
            "slot": "vi-app-config"
        }
    })
    export class AppSetting extends WebComponent {
        key: string;
        value: string;
    }
}