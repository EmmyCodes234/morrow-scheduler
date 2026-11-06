/**
 * Authentic Microsoft Teams Brand Icon
 * Official Microsoft Fluent Teams logo (2019–present) from Wikimedia Commons.
 */
export function MicrosoftTeamsIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 -77.75 2228.833 2228.833"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Back User Body */}
      <path
        fill="#5059C9"
        d="M1554.637,777.5h575.713c54.391,0,98.483,44.092,98.483,98.483v524.398c0,199.901-162.051,361.952-361.952,361.952h-1.711c-199.901,0.028-361.975-162-362.004-361.901V828.971C1503.167,800.544,1526.211,777.5,1554.637,777.5z"
      />
      {/* Back User Head */}
      <circle fill="#5059C9" cx="1943.75" cy="440.583" r="233.25" />
      {/* Front User Head */}
      <circle fill="#7B83EB" cx="1218.083" cy="336.917" r="336.917" />
      {/* Front User Body */}
      <path
        fill="#7B83EB"
        d="M1667.323,777.5H717.01c-53.743,1.33-96.257,45.931-95.01,99.676v598.105c-7.505,322.519,247.657,590.16,570.167,598.053c322.51-7.893,577.671-275.534,570.167-598.053V877.176C1763.579,823.431,1721.066,778.83,1667.323,777.5z"
      />
      {/* Soft shadow */}
      <path
        opacity=".15"
        d="M1244,777.5v838.145c-0.258,38.435-23.549,72.964-59.09,87.598c-11.316,4.787-23.478,7.254-35.765,7.257H667.613c-6.738-17.105-12.958-34.21-18.142-51.833c-18.144-59.477-27.402-121.307-27.472-183.49V877.02c-1.246-53.659,41.198-98.19,94.855-99.52H1244z"
      />
      {/* Gradient Tile with 'T' Badge */}
      <linearGradient
        id="teamsFluentGrad"
        gradientUnits="userSpaceOnUse"
        x1="198.099"
        y1="1683.0726"
        x2="942.2344"
        y2="394.2607"
        gradientTransform="matrix(1 0 0 -1 0 2075.3333)"
      >
        <stop offset="0" stopColor="#5a62c3" />
        <stop offset=".5" stopColor="#4d55bd" />
        <stop offset="1" stopColor="#3940ab" />
      </linearGradient>
      <path
        fill="url(#teamsFluentGrad)"
        d="M95.01,466.5h950.312c52.473,0,95.01,42.538,95.01,95.01v950.312c0,52.473-42.538,95.01-95.01,95.01H95.01c-52.473,0-95.01-42.538-95.01-95.01V561.51C0,509.038,42.538,466.5,95.01,466.5z"
      />
      <path fill="#FFFFFF" d="M820.211,828.193H630.241v517.297H509.211V828.193H320.123V727.844h500.088V828.193z" />
    </svg>
  );
}
