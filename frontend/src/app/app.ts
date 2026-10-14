import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/** Root shell — the feature routes (login / environments) own the page. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class App {}
