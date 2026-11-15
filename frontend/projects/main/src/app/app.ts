import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MaintenanceBanner } from './maintenance';

/** The app shell. No environment ribbon or title prefix on any site (decided 2026-10-24). */
@Component({
  imports: [RouterOutlet, MaintenanceBanner],
  selector: 'zed-root',
  template: '<zed-maintenance /><router-outlet />',
})
export class App {}
