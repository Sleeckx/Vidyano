module Vidyano.WebComponents {
    @WebComponent.register({
        properties: {
            scroll: {
                type: Boolean,
                reflectToAttribute: true,
                value: false
            }
        }
    })
    export class Website extends WebComponent {
        attached() {
            super.attached();

            if (this.app)
                return;

            var template = Polymer.dom(this).querySelector("template[is='dom-template']");
            if (!template) {
                console.error("Website requires a valid template.");
                return;
            }

            var config = new Vidyano.WebComponents.PersistentObjectConfig();
            config.id = "3256a3ad-3035-44ec-b3dd-7c9bdd14a3a7";
            config.as = "website";
            config.asModel = po => {
                const model = {
                    label: po.attributes["Label"].displayValue,
                    pages: po.queries["Website_Pages"].items.map(i => new WebsitePageModel(i))
                };

                model.pages.forEach(p => model.pages[p.name] = p);
                return model;
            };

            this._setApp(new Vidyano.WebComponents.App());
            this.app.uri = "";
            this.app.noMenu = true;
            this.app.noHistory = true;
            this.app.path = `PersistentObject.${config.id}`;
            this.app.hooks = "Vidyano.WebComponents.WebsiteAppServiceHooks";

            Polymer.dom(config).appendChild(template);
            Polymer.dom(this.app).appendChild(config);
            Polymer.dom(this).appendChild(this.app);
        }
    }

    export class WebsiteAppServiceHooks extends AppServiceHooks {
        createData(data: any) {
            data.isMobile = false;
        }
    }

    export class WebsitePageModel {
        private _name: string;
        private _label: string;
        private _content: string;

        constructor(page: Vidyano.QueryResultItem) {
            this._name = page.values["Name"];
            this._label = page.values["Label"];
            this._content = page.values["Content"];
        }

        get name(): string {
            return this._name;
        }

        get label(): string {
            return this._label;
        }

        get content(): string {
            return this._content;
        }
    }
}