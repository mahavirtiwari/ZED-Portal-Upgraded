import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ClientConfigService, EnvironmentBanner, EnvironmentLabelService } from '@zed/shared';

@Component({
  imports: [RouterOutlet, EnvironmentBanner],
  selector: 'zed-root',
  template: '<zed-environment-banner /><router-outlet />',
})
export class App implements OnInit {
  private readonly config = inject(ClientConfigService);
  private readonly environment = inject(EnvironmentLabelService);

  ngOnInit(): void {
    // A test environment (Portal:EnvironmentLabel) shows a ribbon and prefixes the title; nothing in Production.
    this.config.get().then(
      (c) => this.environment.set(c.environmentLabel),
      () => undefined,
    );
  }
}
