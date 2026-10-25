import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/** The app shell. No environment ribbon or title prefix on any site (decided 2026-10-24). */
@Component({
  imports: [RouterOutlet],
  selector: 'zed-root',
  template: '<router-outlet />',
})
export class App {}
